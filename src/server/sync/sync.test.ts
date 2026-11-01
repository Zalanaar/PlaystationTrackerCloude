import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@/db';
import { PsnError } from '@/server/psn/errors';
import { connectPsn } from '@/server/psn/client';
import { runChunk, type ChunkResult, type SyncDeps } from './engine';
import { startRun, STALE_RUN_MS, type RunKind } from './runs';
import { getSyncStatus } from './status';
import { createTestDb, fakeApi, freshState, type FakeState, type TestDb } from './test-helpers';
import { setGameStatus } from './status-rules';
import { TEST_USER } from '@/server/sync/test-helpers';

const { games, playtimeSnapshots, trophySets, trophies, gameTrophySets, syncRuns, gameStatus } = schema;

/** Копия строки без указанных полей (временные метки и id, не участвующие в сравнении). */
const omit = <T extends object, K extends string>(row: T, ...keys: K[]) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !(keys as string[]).includes(k))) as Omit<T, K>;

const DAY1 = new Date('2026-10-27T17:00:00Z'); // 20:00 МСК
const DAY2 = new Date('2026-10-28T17:00:00Z');

describe('синк на PGlite и фейковом PSN', () => {
  let t: TestDb;
  let state: FakeState;
  const clock = { t: DAY1.getTime() };

  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    state = freshState();
    clock.t = DAY1.getTime();
  });

  const deps = (o: { budgetMs?: number; delayMs?: number; connect?: SyncDeps['connect'] } = {}): SyncDeps => ({
    db: t.db,
    now: () => new Date(clock.t),
    budgetMs: o.budgetMs ?? 1_000_000,
    connect:
      o.connect ??
      (() =>
        connectPsn({
          getAccessToken: async () => 'test-token',
          onlineId: 'Target',
          delayMs: o.delayMs ?? 0,
          api: fakeApi(state),
          sleep: async (ms) => {
            clock.t += ms;
          },
          now: () => clock.t,
        })),
  });

  /** Один вызов: start + одно звено. */
  async function once(o: Parameters<typeof deps>[0] & { kind?: RunKind; continueRunId?: number } = {}) {
    const s = await startRun(t.db, TEST_USER, { kind: o.kind ?? 'manual', now: new Date(clock.t), continueRunId: o.continueRunId });
    if (s.kind !== 'started') throw new Error('не стартовало: ' + s.kind);
    const res = await runChunk(deps(o), s.run);
    return { run: s.run, res, resumed: s.resumed };
  }
  /** Цепочка звеньев до конца (как самовызов). */
  async function full(o: Parameters<typeof deps>[0] = {}) {
    const first = await once(o);
    const run = first.run;
    let res = first.res;
    let chunks = 1;
    while (res.continueNext && chunks < 50) {
      ({ res } = await once({ ...o, continueRunId: run.id }));
      chunks++;
    }
    return { runId: run.id, res, chunks };
  }

  const dump = async () => ({
    games: await t.db.select().from(games).orderBy(asc(games.titleId)),
    snaps: (await t.db.select().from(playtimeSnapshots).orderBy(asc(playtimeSnapshots.gameId), asc(playtimeSnapshots.snapshotDate))).map((r) =>
      omit(r, 'capturedAt', 'syncRunId', 'id'),
    ),
    sets: await t.db.select().from(trophySets).orderBy(asc(trophySets.npCommunicationId)),
    trophies: (await t.db.select().from(trophies).orderBy(asc(trophies.trophySetId), asc(trophies.trophyId))).map((r) => omit(r, 'updatedAt')),
    links: await t.db.select().from(gameTrophySets).orderBy(asc(gameTrophySets.gameId), asc(gameTrophySets.trophySetId)),
  });
  const rowCounts = async () => {
    const d = await dump();
    return { games: d.games.length, snaps: d.snaps.length, sets: d.sets.length, trophies: d.trophies.length, links: d.links.length };
  };

  it('первый синк: игры, снимки, сеты, трофеи, связи', async () => {
    const { res, runId } = await full();
    expect(res).toMatchObject({ status: 'success', reason: null });
    expect(await rowCounts()).toEqual({ games: 6, snaps: 6, sets: 5, trophies: 9, links: 5 });

    const d = await dump();
    expect(d.games.map((g) => g.titleId)).not.toContain('PPSA09999_00'); // не-игра отброшена
    const beta = d.games.find((g) => g.titleId === 'PPSA00003_00');
    expect(beta).toMatchObject({ playDurationSeconds: 360030, psnGenres: ['RACING', 'SIMULATOR'], conceptId: '1003' });
    expect(d.games.every((g) => g.trophyCheckedAt !== null)).toBe(true);
    expect(d.games.find((g) => g.titleId === 'PCSA00007_00')?.psnGenres).toEqual(['UNIQUE']);

    // связи: title_id, concept (сиблинг), name (сирота), несколько сетов, игры без сета
    const srcOf = (title: string) => {
      const gid = d.games.find((g) => g.titleId === title)!.id;
      return d.links
        .filter((l) => l.gameId === gid)
        .map((l) => `${d.sets.find((s) => s.id === l.trophySetId)!.npCommunicationId}:${l.source}`)
        .sort();
    };
    expect(srcOf('CUSA00001_00')).toEqual(['NPWR00001_00:title_id']);
    expect(srcOf('PPSA00002_00')).toEqual(['NPWR00001_00:concept']);
    expect(srcOf('PPSA00003_00')).toEqual(['NPWR00003_00:title_id', 'NPWR00004_00:title_id']);
    expect(srcOf('PPSA00006_00')).toEqual(['NPWR00006_00:name']);
    expect(srcOf('CUSA00005_00')).toEqual([]);
    expect(srcOf('PCSA00007_00')).toEqual([]);
    // сирота хранится и трофеи его учтены
    expect(d.links.some((l) => l.trophySetId === d.sets.find((s) => s.npCommunicationId === 'NPWR00009_00')!.id)).toBe(false);

    // трофеи: earned_at, платина, скрытый без имени, имя из defs
    const setId = (np: string) => d.sets.find((s) => s.npCommunicationId === np)!.id;
    const alpha = d.trophies.filter((x) => x.trophySetId === setId('NPWR00001_00'));
    expect(alpha.filter((x) => x.earned).map((x) => x.earnedAt?.toISOString())).toEqual(['2026-09-30T20:00:00.000Z', '2025-01-10T19:00:00.000Z']);
    expect(alpha.find((x) => x.trophyId === 2)).toMatchObject({ hidden: true, name: null, earned: false, earnedAt: null });
    expect(alpha.find((x) => x.trophyId === 0)).toMatchObject({ name: 'Finale', type: 'gold', rarity: 2, earnedRate: '12.30' });
    expect(d.trophies.filter((x) => x.type === 'platinum' && x.earned)).toHaveLength(1);
    expect(d.sets.every((s) => s.trophiesSyncedAt !== null)).toBe(true);
    expect(d.sets.find((s) => s.npCommunicationId === 'NPWR00003_00')).toMatchObject({ progress: 100, earnedPlatinum: 1, npServiceName: 'trophy2' });

    // снимки: дата МСК из started_at
    expect(d.snaps.every((s) => s.snapshotDate === '2026-10-27')).toBe(true);
    const [run] = await t.db.select().from(syncRuns).where(eq(syncRuns.id, runId));
    expect(run).toMatchObject({
      status: 'success',
      snapshotDate: '2026-10-27',
      cursor: null,
      gamesSeen: 6,
      gamesUpserted: 6,
      snapshotsWritten: 6,
      trophySetsSynced: 5,
      trophiesUpserted: 9,
      errorReason: null,
    });
    expect(run.finishedAt).not.toBeNull();
  });

  it('идемпотентность: два прогона = те же данные, без дублей и лишних запросов трофеев', async () => {
    await full();
    const first = await dump();
    const calls = { ...state.calls };
    const second = await full();
    expect(second.res.status).toBe('success');
    const after = await dump();
    // одинаковые данные (updated_at и captured_at не сравниваем)
    const strip = (rows: object[]) => rows.map((r) => omit(r, 'updatedAt', 'lastSeenAt'));
    expect(strip(after.games)).toEqual(strip(first.games));
    expect(after.snaps).toEqual(first.snaps);
    expect(strip(after.sets)).toEqual(strip(first.sets));
    expect(after.trophies).toEqual(first.trophies);
    expect(after.links).toEqual(first.links.map((l) => ({ ...l })));
    // повтор не ходит за трофеями и сопоставлением заново
    expect(state.calls.earned).toBe(calls.earned);
    expect(state.calls.defs).toBe(calls.defs);
    expect(state.calls.specific).toBe(calls.specific);
    expect(await t.db.select().from(syncRuns)).toHaveLength(2);
  });

  it('снимки: новый день = новые строки, тот же день = перезапись, время идёт вперёд', async () => {
    await full();
    const gid = (await t.db.select().from(games).where(eq(games.titleId, 'PPSA00003_00')))[0].id;
    // день 2: игрок наиграл ещё 2 часа
    clock.t = DAY2.getTime();
    state.titles.find((x) => x.titleId === 'PPSA00003_00')!.playDuration = 'PT102H0M30S';
    await full();
    const snaps = await t.db.select().from(playtimeSnapshots).where(eq(playtimeSnapshots.gameId, gid)).orderBy(asc(playtimeSnapshots.snapshotDate));
    expect(snaps.map((s) => [s.snapshotDate, s.playDurationSeconds])).toEqual([
      ['2026-10-27', 360030],
      ['2026-10-28', 367230],
    ]);
    // второй синк того же дня перезаписывает, а не дублирует
    state.titles.find((x) => x.titleId === 'PPSA00003_00')!.playDuration = 'PT103H0M30S';
    clock.t = DAY2.getTime() + 3600_000;
    await full();
    const again = await t.db.select().from(playtimeSnapshots).where(eq(playtimeSnapshots.gameId, gid));
    expect(again).toHaveLength(2);
    expect(again.find((s) => s.snapshotDate === '2026-10-28')?.playDurationSeconds).toBe(370830);
    expect((await t.db.select().from(games)).length).toBe(6);
  });

  it('дата снимка берётся из started_at по Москве и не плывёт, если запуск идёт через полночь', async () => {
    clock.t = new Date('2026-10-27T20:59:00Z').getTime(); // 23:59 МСК
    const { runId } = await full({ delayMs: 5000 }); // запуск растягивается за полночь МСК
    const [run] = await t.db.select().from(syncRuns).where(eq(syncRuns.id, runId));
    expect(run.snapshotDate).toBe('2026-10-27');
    expect(new Date(clock.t).toISOString() > '2026-10-27T21:00:00.000Z').toBe(true);
    const dates = new Set((await t.db.select().from(playtimeSnapshots)).map((s) => s.snapshotDate));
    expect([...dates]).toEqual(['2026-10-27']);
  });

  it('уменьшение времени: берём значение PSN и пишем предупреждение', async () => {
    await full();
    state.titles.find((x) => x.titleId === 'PPSA00003_00')!.playDuration = 'PT1H';
    clock.t = DAY2.getTime();
    const { runId } = await full();
    const [run] = await t.db.select().from(syncRuns).where(eq(syncRuns.id, runId));
    expect(run.warnings).toEqual([expect.objectContaining({ code: 'playtime_decreased' })]);
    expect((await t.db.select().from(games).where(eq(games.titleId, 'PPSA00003_00')))[0].playDurationSeconds).toBe(3600);
  });

  it('сбой PSN на фазе игр не стирает данные и не пишет снимки', async () => {
    await full();
    const before = await rowCounts();
    const gamesBefore = await t.db.select().from(games);
    clock.t = DAY2.getTime();
    state.failOn.set('played', { error: new Error('Service Unavailable 503'), times: 99 });
    const { res, runId } = await full();
    expect(res).toMatchObject({ status: 'failed', reason: 'psn_unavailable', continueNext: false });
    expect(await rowCounts()).toEqual(before);
    expect((await t.db.select().from(games)).map((g) => g.playDurationSeconds)).toEqual(gamesBefore.map((g) => g.playDurationSeconds));
    const [run] = await t.db.select().from(syncRuns).where(eq(syncRuns.id, runId));
    expect(run).toMatchObject({ status: 'failed', errorReason: 'psn_unavailable' });
    expect(run.finishedAt).not.toBeNull();
    const st = await getSyncStatus(t.db, TEST_USER);
    expect(st).toMatchObject({ running: false, psnAuth: 'ok' });
    expect(st.lastSuccessAt).not.toBeNull();
  });

  it('auth_expired: запуск failed, данные целы, статус показывает psnAuth=auth_expired', async () => {
    await full();
    const before = await rowCounts();
    clock.t = DAY2.getTime();
    const { res } = await full({
      connect: async () => {
        throw new PsnError('auth_expired', 'нужен новый NPSSO');
      },
    });
    expect(res).toMatchObject({ status: 'failed', reason: 'auth_expired' });
    expect(await rowCounts()).toEqual(before);
    const st = await getSyncStatus(t.db, TEST_USER);
    expect(st.psnAuth).toBe('auth_expired');
    expect(st.run).toMatchObject({ status: 'failed', errorReason: 'auth_expired' });
  });

  it('сбой в середине (трофеи): partial с курсором, данные игр на месте, следующий вызов дожимает без дублей', async () => {
    state.failOn.set('earned', { error: new Error('429 Too Many Requests'), times: 99 });
    const a = await once();
    expect(a.res).toMatchObject({ status: 'partial', reason: 'rate_limited', continueNext: false });
    expect((await t.db.select().from(games)).length).toBe(6);
    expect((await t.db.select().from(trophySets)).length).toBe(5);
    expect(await t.db.select().from(trophies)).toHaveLength(0);
    const [r1] = await t.db.select().from(syncRuns);
    expect(r1.cursor).toMatchObject({ phase: 'trophies' });
    expect(r1.errorMessage).not.toBeNull();

    // PSN пришёл в себя, кнопка/cron возобновляют тот же запуск
    state.failOn.clear();
    const b = await once();
    expect(b.resumed).toBe(true);
    expect(b.run.id).toBe(a.run.id);
    expect(b.res.status).toBe('success');
    expect(await rowCounts()).toEqual({ games: 6, snaps: 6, sets: 5, trophies: 9, links: 5 });
    expect(await t.db.select().from(syncRuns)).toHaveLength(1);
    const [r2] = await t.db.select().from(syncRuns);
    expect(r2).toMatchObject({ status: 'success', errorReason: null, errorMessage: null, trophiesUpserted: 9 });
  });

  it('батчи и курсор: малый бюджет режет работу на звенья, итог тот же, что за один проход', async () => {
    await full();
    const expected = await dump();
    await t.reset();
    clock.t = DAY1.getTime();
    state = freshState();

    const first = await once({ budgetMs: 4000, delayMs: 1000 });
    expect(first.res).toMatchObject({ status: 'partial', reason: 'timeout', continueNext: true });
    const [mid] = await t.db.select().from(syncRuns);
    expect(mid).toMatchObject({ status: 'partial', errorReason: 'timeout' });
    expect(mid.cursor).toMatchObject({ hops: 1 });
    // курсор и часть данных записаны, но не всё
    expect((await t.db.select().from(trophies)).length).toBeLessThan(9);

    // status отражает прогресс
    const st = await getSyncStatus(t.db, TEST_USER);
    expect(st.running).toBe(false);
    expect(st.run?.status).toBe('partial');

    let chunks = 1;
    let last: ChunkResult = first.res;
    while (last.continueNext) {
      ({ res: last } = await once({ budgetMs: 4000, delayMs: 1000, continueRunId: mid.id }));
      chunks++;
      expect(chunks).toBeLessThan(40);
    }
    expect(chunks).toBeGreaterThan(2);
    expect(last.status).toBe('success');
    expect(await t.db.select().from(syncRuns)).toHaveLength(1);
    const got = await dump();
    const strip = (rows: object[]) => rows.map((r) => omit(r, 'id', 'updatedAt', 'lastSeenAt', 'firstSeenAt', 'createdAt', 'trophyCheckedAt', 'trophiesSyncedAt'));
    expect(strip(got.games)).toEqual(strip(expected.games));
    expect(got.trophies.length).toBe(expected.trophies.length);
    expect(got.links.length).toBe(expected.links.length);
    const [done] = await t.db.select().from(syncRuns);
    expect(done).toMatchObject({ status: 'success', cursor: null, trophySetsSynced: 5, trophiesUpserted: 9 });
  });

  it('при нулевом бюджете звено всё равно делает шаг вперёд', async () => {
    const a = await once({ budgetMs: 0 });
    expect(a.res.status).toBe('partial');
    const b = await once({ budgetMs: 0, continueRunId: a.run.id });
    const [run] = await t.db.select().from(syncRuns);
    expect(run.cursor).not.toEqual(a.run.cursor);
    expect(b.res.status).not.toBe('failed');
  });

  it('предохранитель: после 20 самовызовов цепочка не продолжается', async () => {
    const a = await once({ budgetMs: 0 });
    expect(a.res.continueNext).toBe(true);
    const [cur] = await t.db.select().from(syncRuns);
    await t.db.update(syncRuns).set({ cursor: { ...(cur.cursor as object), hops: 20 } }).where(eq(syncRuns.id, a.run.id));
    const s = await startRun(t.db, TEST_USER, { kind: 'daily', now: new Date(clock.t), continueRunId: a.run.id });
    if (s.kind !== 'started') throw new Error();
    const res = await runChunk(deps({ budgetMs: 0 }), s.run);
    expect(res).toMatchObject({ status: 'partial', reason: 'timeout', continueNext: false });
  });

  it('один running: второй старт получает already_running; завис дольше 15 минут: закрывается как failed/timeout', async () => {
    const a = await startRun(t.db, TEST_USER, { kind: 'daily', now: new Date(clock.t) });
    expect(a.kind).toBe('started');
    const b = await startRun(t.db, TEST_USER, { kind: 'manual', now: new Date(clock.t + 60_000) });
    expect(b).toMatchObject({ kind: 'already_running' });
    expect(await t.db.select().from(syncRuns)).toHaveLength(1);

    const c = await startRun(t.db, TEST_USER, { kind: 'manual', now: new Date(clock.t + STALE_RUN_MS + 60_000) });
    expect(c.kind).toBe('started');
    const rows = await t.db.select().from(syncRuns).orderBy(asc(syncRuns.id));
    expect(rows[0]).toMatchObject({ status: 'failed', errorReason: 'timeout' });
    expect(rows[1].status).toBe('running');
  });

  it('heartbeat в курсоре защищает долгий запуск от закрытия как брошенного', async () => {
    const a = await startRun(t.db, TEST_USER, { kind: 'daily', now: new Date(clock.t) });
    if (a.kind !== 'started') throw new Error();
    const later = new Date(clock.t + 20 * 60_000);
    await t.db.update(syncRuns).set({ cursor: { phase: 'trophies', hops: 1, heartbeat: new Date(later.getTime() - 60_000).toISOString() } });
    const b = await startRun(t.db, TEST_USER, { kind: 'manual', now: later });
    expect(b.kind).toBe('already_running');
  });

  it('partial старше 6 часов не возобновляется: новый запуск; continue только для partial/timeout', async () => {
    state.failOn.set('earned', { error: new Error('503'), times: 99 });
    const a = await once();
    expect(a.res.status).toBe('partial');
    expect(await startRun(t.db, TEST_USER, { kind: 'daily', now: new Date(clock.t), continueRunId: a.run.id })).toMatchObject({ kind: 'not_resumable' });
    const b = await startRun(t.db, TEST_USER, { kind: 'daily', now: new Date(clock.t + 7 * 3600_000) });
    expect(b).toMatchObject({ kind: 'started', resumed: false });
    expect(await startRun(t.db, TEST_USER, { kind: 'daily', now: new Date(clock.t), continueRunId: 9999 })).toMatchObject({ kind: 'not_resumable' });
  });

  it('полученный трофей не откатывается при неполном ответе PSN; новые получения подтягиваются точечно', async () => {
    await full();
    const set1 = (await t.db.select().from(trophySets).where(eq(trophySets.npCommunicationId, 'NPWR00001_00')))[0];
    const earnedCalls = state.calls.earned;
    const defsCalls = state.calls.defs;

    // PSN отдал неполный ответ (платиновый-золотой трофей «не получен») и заодно новый трофей получен
    clock.t = DAY2.getTime();
    const tr = state.trophies['NPWR00001_00'].earned;
    tr[0] = { ...tr[0], earned: false, earnedDateTime: undefined };
    tr[1] = { ...tr[1], earned: true, earnedDateTime: '2026-10-28T10:00:00Z' };
    state.trophyTitles.find((x) => x.npCommunicationId === 'NPWR00001_00')!.lastUpdatedDateTime = '2026-10-28T10:00:00Z';
    await full();

    expect(state.calls.earned).toBe(earnedCalls + 2); // перезагружен только изменившийся сет (2 страницы по 3)
    expect(state.calls.defs).toBe(defsCalls); // определения уже есть, повторно не нужны
    const rows = await t.db.select().from(trophies).where(eq(trophies.trophySetId, set1.id)).orderBy(asc(trophies.trophyId));
    expect(rows[0]).toMatchObject({ earned: true });
    expect(rows[0].earnedAt?.toISOString()).toBe('2026-09-30T20:00:00.000Z');
    expect(rows[1]).toMatchObject({ earned: true });
    expect(rows[1].earnedAt?.toISOString()).toBe('2026-10-28T10:00:00.000Z');
    expect(rows[0].name).toBe('Finale'); // определения не потеряны
    expect(rows).toHaveLength(4);
  });

  it('новый сет и новая игра добавляются, старое остаётся даже если пропало из ответа PSN', async () => {
    await full();
    const removed = state.titles.splice(3, 1)[0]; // Gamma Puzzle пропала из ответа
    expect(removed.titleId).toBe('CUSA00005_00');
    state.titles.push({ ...(structuredClone(removed) as object), titleId: 'CUSA00100_00', name: 'Newcomer', localizedName: 'Newcomer', concept: { id: 5000, genres: ['HORROR'] } } as never);
    clock.t = DAY2.getTime();
    await full();
    const all = await t.db.select().from(games).orderBy(asc(games.titleId));
    expect(all.map((g) => g.titleId)).toContain('CUSA00005_00'); // не удалена
    expect(all.map((g) => g.titleId)).toContain('CUSA00100_00');
    const gamma = all.find((g) => g.titleId === 'CUSA00005_00')!;
    const snaps = await t.db.select().from(playtimeSnapshots).where(eq(playtimeSnapshots.snapshotDate, '2026-10-28'));
    expect(snaps.some((s) => s.gameId === gamma.id)).toBe(false); // снимок только тем, кто пришёл
    expect(snaps).toHaveLength(6);
  });

  it('синк не пишет в game_status', async () => {
    await full();
    const g = (await t.db.select().from(games).where(eq(games.titleId, 'CUSA00005_00')))[0];
    await setGameStatus(t.db, TEST_USER, g.id, 'completed', new Date(clock.t));
    const before = await t.db.select().from(gameStatus);
    clock.t = DAY2.getTime();
    await full();
    expect(await t.db.select().from(gameStatus)).toEqual(before);
    expect(before[0].completedAt).toEqual(g.lastPlayedAt);
  });

  it('игры без сета перепроверяются раз в 7 дней, не чаще', async () => {
    await full();
    const specific = state.calls.specific; // 2 пачки по 5 (6 игр)
    clock.t = DAY2.getTime();
    await full();
    expect(state.calls.specific).toBe(specific);
    clock.t = DAY1.getTime() + 8 * 86400_000;
    // игры без сета: Gamma, Epsilon (concept-связь у PPSA00002 есть, но title_id нет: тоже перепроверяется)
    const { runId } = await full();
    const recheck = state.calls.specific - specific;
    expect(recheck).toBe(1);
    const [run] = await t.db.select().from(syncRuns).where(eq(syncRuns.id, runId));
    expect(run.status).toBe('success');
    // связи не задвоились
    expect((await t.db.select().from(gameTrophySets)).length).toBe(5);
  });

  it('статус: прогресс, счётчики и конверт для running', async () => {
    expect(await getSyncStatus(t.db, TEST_USER)).toEqual({ running: false, run: null, lastSuccessAt: null, psnAuth: 'unknown', psnToken: null, psnAuthExpiresAt: null, totals: { games: 0, trophySets: 0, trophies: 0, trophiesEarned: 0, platinumEarned: 0 }, overdue: { isOverdue: false, ageHours: null, thresholdHours: 30 } });
    const s = await startRun(t.db, TEST_USER, { kind: 'manual', now: new Date(clock.t) });
    if (s.kind !== 'started') throw new Error();
    const st = await getSyncStatus(t.db, TEST_USER);
    expect(st.running).toBe(true);
    expect(st.run).toMatchObject({ status: 'running', phase: 'auth', progress: { step: 1, steps: 4, done: null, total: null } });
    await t.db.update(syncRuns).set({ phase: 'trophies', cursor: { phase: 'trophies', hops: 0, progress: { done: 3, total: 5 } } }).where(and(eq(syncRuns.id, s.run.id)));
    expect((await getSyncStatus(t.db, TEST_USER)).run?.progress).toEqual({ phase: 'trophies', step: 4, steps: 4, done: 3, total: 5 });
  });

  it('статус: totals считаются из БД', async () => {
    const [set] = await t.db.insert(schema.trophySets).values({ userId: 1, npCommunicationId: 'NPWRTOT', npServiceName: 'trophy', name: 'T' }).returning();
    await t.db.insert(schema.trophies).values([
      { userId: 1, trophySetId: set.id, trophyId: 0, type: 'platinum', earned: true, earnedAt: new Date(clock.t) },
      { userId: 1, trophySetId: set.id, trophyId: 1, type: 'bronze', earned: true, earnedAt: new Date(clock.t) },
      { userId: 1, trophySetId: set.id, trophyId: 2, type: 'gold' },
      { userId: 1, trophySetId: set.id, trophyId: 3, type: 'platinum' },
    ]);
    const st = await getSyncStatus(t.db, TEST_USER);
    const gamesCount = (await t.db.select().from(schema.games)).length;
    expect(st.totals).toEqual({ games: gamesCount, trophySets: 1, trophies: 4, trophiesEarned: 2, platinumEarned: 1 });
  });

  it('ошибка БД/внутренняя: failed/internal без SQL-параметров в сообщении', async () => {
    const { res, runId } = await full({
      connect: async () => {
        throw new Error('Failed query: insert into x params: secret-param-value-123');
      },
    });
    expect(res).toMatchObject({ status: 'failed', reason: 'internal' });
    const [run] = await t.db.select().from(syncRuns).where(eq(syncRuns.id, runId));
    expect(run.errorMessage).not.toContain('secret-param-value-123');
  });
});
