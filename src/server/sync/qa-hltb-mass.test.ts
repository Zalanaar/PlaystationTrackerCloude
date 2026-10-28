// QA приёмки PR #10 (контракт 16.6, 16.7): матчер, лимит запросов, слот running, перепроверка. Независимо от тестов автора.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import type { HltbClient } from '@/server/hltb/client';
import { pickAny, searchTerms, type HltbCandidate } from '@/server/hltb/normalize';
import { runHltbMass } from './hltb-run';
import type { HltbDeps } from './hltb-step';
import { HLTB_STALE_RUN_MS, startRun, STALE_RUN_MS } from './runs';
import { createTestDb, type TestDb } from './test-helpers';

const { games, gameStatus, syncRuns } = schema;
const T0 = new Date('2026-10-28T10:00:00Z');
const c = (id: number, name: string): HltbCandidate => ({ id, name, mainHours: 10, extraHours: null });

describe('QA матчер 16.6', () => {
  const pick = (psn: string, names: string[]) => pickAny(psn, names.map((n, i) => c(i + 1, n)))?.name ?? null;
  it('находятся', () => {
    expect(pick('Diablo II: Resurrected', ['Diablo II: Resurrected', 'Diablo II'])).toBe('Diablo II: Resurrected');
    expect(pick('Diablo II Resurrected', ['Diablo II: Resurrected'])).toBe('Diablo II: Resurrected');
    expect(pick('Gothic Classic', ['Gothic', 'Gothic II'])).toBe('Gothic');
    expect(pick('Gothic Classic', ['Gothic II', 'Gothic'])).toBe('Gothic');
  });
  it('не находятся (чужая часть серии / подзаголовок)', () => {
    expect(pick('Gothic II', ['Gothic'])).toBeNull();
    expect(pick('Gothic II Classic', ['Gothic'])).toBeNull();
    expect(pick('Diablo III', ['Diablo II', 'Diablo II: Resurrected'])).toBeNull();
    expect(pick('Diablo III: Reaper of Souls - Ultimate Evil Edition', ['Diablo II'])).toBeNull();
    expect(pick('Batman: Arkham Knight', ['Batman', 'Batman: Arkham City'])).toBeNull();
    expect(pick('Call of Duty: Black Ops', ['Call of Duty', 'Call of Duty: Black Ops III'])).toBeNull();
    expect(pick('Call of Duty: Black Ops', ['Call of Duty: Black Ops 4'])).toBeNull();
    expect(pick('Classic', ['Gothic'])).toBeNull();
  });
  it('searchTerms: не больше 3, без пустых', () => {
    for (const n of ['Diablo II Resurrected', 'Gothic Classic', 'Call of Duty: Black Ops', 'X', '™®']) {
      const t = searchTerms(n);
      expect(t.length).toBeLessThanOrEqual(3);
      expect(t.every((x) => x.length > 0)).toBe(true);
    }
  });
});

describe('QA массовый запуск', () => {
  let t: TestDb;
  beforeAll(async () => void (t = await createTestDb()));
  afterAll(() => t.close());
  beforeEach(() => t.reset());
  const mkDeps = (search: HltbClient['search']): HltbDeps => ({ client: { search }, sleep: async () => undefined });
  async function add(name: string, status: 'backlog' | null = 'backlog', extra: Partial<typeof games.$inferInsert> = {}) {
    const [g] = await t.db.insert(games).values({ titleId: `T-${name}`, name, category: 'ps5_native_game', lastSeenAt: T0, ...extra }).returning({ id: games.id });
    if (status) await t.db.insert(gameStatus).values({ gameId: g.id, status });
    return g.id;
  }

  it('не больше 3 запросов на игру', async () => {
    await add('Some Long Unknown Name Here');
    let n = 0;
    const deps = mkDeps(async () => (n++, [c(9, 'Totally Different Thing')]));
    await runHltbMass({ db: t.db, deps, now: () => T0 });
    expect(n).toBeLessThanOrEqual(3);
  });

  it('время вышло посреди поиска игры: not_found не пишется', async () => {
    const id = await add('Some Long Unknown Name Here');
    let ms = T0.getTime();
    const deps = mkDeps(async () => {
      ms += 38_000;
      return [c(9, 'Totally Different Thing')];
    });
    // бюджет 45 с, порог 9 с: после первого запроса (38 с) до второго остаётся 7 с (у названия 2 запроса)
    const r = await runHltbMass({ db: t.db, deps, now: () => new Date(ms) });
    const [g] = await t.db.select().from(games).where(eq(games.id, id));
    expect(g.hltbCheckedAt).toBeNull();
    expect(r.kind === 'done' && r.result.processed).toBe(0);
    expect(r.kind === 'done' && r.result.done).toBe(true); // цикл фронта не зацикливается
  });

  it('потерянное совпадение не стирает часы найденной игры, повтор не дублирует', async () => {
    const lost = await add('Hades', 'backlog', { hltbId: 5, hltbName: 'Hades', hltbMainHours: 22.5, hltbExtraHours: 30, hltbCheckedAt: new Date('2026-01-01T00:00:00Z') });
    await add('Celeste');
    const deps = mkDeps(async (term) => (term.includes('celeste') ? [c(7, 'Celeste')] : []));
    await runHltbMass({ db: t.db, deps, now: () => T0 });
    const [g] = await t.db.select().from(games).where(eq(games.id, lost));
    expect(g).toMatchObject({ hltbId: 5, hltbMainHours: 22.5, hltbExtraHours: 30 });
    const r2 = await runHltbMass({ db: t.db, deps, now: () => T0 });
    expect(r2.kind === 'done' && r2.result.processed).toBe(0);
    expect(await t.db.select().from(syncRuns)).toHaveLength(2);
  });

  it('ручное значение не перетирается и игра не берётся', async () => {
    const id = await add('Hades', 'backlog', { durationOverrideHours: 12 });
    let n = 0;
    await runHltbMass({ db: t.db, deps: mkDeps(async () => (n++, [c(1, 'Hades')])), now: () => T0 });
    const [g] = await t.db.select().from(games).where(eq(games.id, id));
    expect(n).toBe(0);
    expect(g.durationOverrideHours).toBe(12);
  });

  it('убитая функция: running от hltb блокирует синк до 15 минут, потом закрывается как timeout (не навсегда)', async () => {
    await t.db.insert(syncRuns).values({ kind: 'hltb', status: 'running', snapshotDate: '2026-10-28', startedAt: T0, phase: 'hltb', cursor: { phase: 'games', hops: 0, heartbeat: T0.toISOString() } });
    const early = await startRun(t.db, { kind: 'manual', now: new Date(T0.getTime() + 60_000) });
    expect(early.kind).toBe('already_running');
    const late = await runHltbMass({ db: t.db, deps: mkDeps(async () => []), now: () => new Date(T0.getTime() + STALE_RUN_MS + 1000) });
    expect(late.kind).toBe('done');
    const [dead] = await t.db.select().from(syncRuns).where(eq(syncRuns.id, 1));
    expect(dead).toMatchObject({ status: 'failed', errorReason: 'timeout' });
  });

  // H-1 исправлен: route отклоняет since из будущего (400 since_in_future), проверка в src/app/api/hltb/run/route.test.ts.
  // Здесь: при фиксированной границе игра, перепроверенная в первом вызове, выходит из отбора.
  it('H-1: фиксированная граница since: перепроверенная not_found не берётся повторно', async () => {
    await add('Unknown Thing', 'backlog', { hltbCheckedAt: new Date('2026-09-01T00:00:00Z') });
    const deps = mkDeps(async () => [c(9, 'Totally Different')]); // непустая выдача, совпадения нет
    const since = new Date(T0.getTime() + 1000);
    const processed: number[] = [];
    for (let i = 0; i < 3; i++) {
      const serverNow = new Date(T0.getTime() + 10_000 + i * 10_000);
      const r = await runHltbMass({ db: t.db, deps, now: () => serverNow, recheckBefore: since });
      processed.push(r.kind === 'done' ? r.result.processed : -1);
    }
    expect(processed).toEqual([1, 0, 0]);
  });

  // L-1: для kind='hltb' порог 2 минуты, heartbeat после каждой пачки.
  const hltbRow = (heartbeat: Date) =>
    t.db.insert(syncRuns).values({ kind: 'hltb', status: 'running', snapshotDate: '2026-10-28', startedAt: T0, phase: 'hltb', cursor: { phase: 'games', hops: 0, heartbeat: heartbeat.toISOString() } });
  const at = (ms: number) => new Date(T0.getTime() + ms);

  it('L-1: hltb-запись блокирует слот в 1 минуту', async () => {
    await hltbRow(T0);
    const r = await startRun(t.db, { kind: 'manual', now: at(60_000) });
    expect(r.kind).toBe('already_running');
  });

  it('L-1: hltb-запись без heartbeat старше 2 минут закрыта как failed/timeout', async () => {
    await hltbRow(T0);
    const r = await startRun(t.db, { kind: 'manual', now: at(HLTB_STALE_RUN_MS + 1000) });
    expect(r.kind).toBe('started');
    const [dead] = await t.db.select().from(syncRuns).where(eq(syncRuns.kind, 'hltb'));
    expect(dead).toMatchObject({ status: 'failed', errorReason: 'timeout' });
  });

  it('L-1: живой heartbeat hltb-записи не закрывается', async () => {
    await hltbRow(at(100_000));
    const r = await startRun(t.db, { kind: 'manual', now: at(HLTB_STALE_RUN_MS + 1000) });
    expect(r.kind).toBe('already_running');
  });

  it('L-1: порог синка не меняется (running manual живёт до 15 минут)', async () => {
    await t.db.insert(syncRuns).values({ kind: 'manual', status: 'running', snapshotDate: '2026-10-28', startedAt: T0, phase: 'auth', cursor: { phase: 'games', hops: 0, heartbeat: T0.toISOString() } });
    expect((await startRun(t.db, { kind: 'daily', now: at(HLTB_STALE_RUN_MS + 1000) })).kind).toBe('already_running');
    expect((await startRun(t.db, { kind: 'daily', now: at(STALE_RUN_MS + 1000) })).kind).toBe('started');
  });

  it('L-1: heartbeat двигается после каждой пачки', async () => {
    await add('A'); await add('B'); await add('C');
    let clock = T0.getTime();
    const seen: string[] = [];
    const deps: HltbDeps = {
      client: {
        search: async () => {
          const [row] = await t.db.select().from(syncRuns).where(eq(syncRuns.kind, 'hltb'));
          seen.push((row.cursor as { heartbeat: string }).heartbeat);
          clock += 1000;
          return [c(9, 'Totally Different')];
        },
      },
      sleep: async () => undefined,
    };
    await runHltbMass({ db: t.db, deps, now: () => new Date(clock), batch: 1 });
    // heartbeat перед 2-й и 3-й пачкой новее, чем перед 1-й
    expect(new Set(seen).size).toBeGreaterThanOrEqual(3);
  });
});
