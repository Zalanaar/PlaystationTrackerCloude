// Фаза 23 (контракт 25): склейка дублей PS4+PS5, часы не теряются, изоляция по user_id, «Это не дубль».
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('no db');
    return holder.db;
  },
}));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

import { POST as notDuplicatePost } from '@/app/api/games/[id]/not-duplicate/route';
import { getGameDetails } from '@/server/collection/details';
import { getCollectionSummary, getGamesByIds, listGames } from '@/server/collection/query';
import { parseListQuery } from '@/server/collection/validation';
import { getBacklogEntries } from '@/server/roadmap/db';
import { getActivity } from '@/server/stats/activity-query';
import { getStats } from '@/server/stats/query';
import { getWrapped } from '@/server/wrapped/query';
import { loadCandidates } from '@/server/recommend/db';
import { applyDuplicates, normalizeGameName, planDuplicates, type DupGame } from '@/server/sync/duplicates';
import { mergeDuplicateSnapshots } from '@/server/stats/duplicates';

const { games, gameStatus, playtimeSnapshots, trophySets, trophies, gameTrophySets } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');
const A = TEST_USER;
const B = TEST_USER_2;

const g = (o: Partial<DupGame> & { id: number }): DupGame => ({ conceptId: null, name: `G${o.id}`, category: 'ps4_game', playSeconds: 0, hidden: false, notDuplicate: false, duplicateOf: null, ...o });

describe('planDuplicates / normalizeGameName (чистые)', () => {
  it('нормализация имени', () => {
    expect(normalizeGameName('FINAL FANTASY XVI™ (PS5)')).toBe('final fantasy xvi');
    expect(normalizeGameName('Starfield: Digital!')).toBe('starfield digital');
  });
  it('пара PS4+PS5 по concept_id: главная = больше часов, второй дубль', () => {
    const plan = planDuplicates([g({ id: 1, conceptId: 'c', playSeconds: 100 }), g({ id: 2, conceptId: 'c', playSeconds: 500, category: 'ps5_native_game' })]);
    expect(plan.get(1)).toBe(2);
    expect(plan.has(2)).toBe(false);
  });
  it('ничья по часам: остаётся текущая главная, иначе PS5, иначе меньший id', () => {
    expect(planDuplicates([g({ id: 1, conceptId: 'c' }), g({ id: 2, conceptId: 'c', category: 'ps5_native_game' })]).get(1)).toBe(2);
    expect(planDuplicates([g({ id: 1, conceptId: 'c' }), g({ id: 2, conceptId: 'c' })]).get(2)).toBe(1);
    expect(planDuplicates([g({ id: 1, conceptId: 'c', duplicateOf: 2 }), g({ id: 2, conceptId: 'c', category: 'ps4_game' })]).size).toBe(0);
  });
  it('запасной ключ: игра без concept_id по имени, к группе по concept_id и между собой', () => {
    const p = planDuplicates([
      g({ id: 1, conceptId: 'c', name: 'Starfield', playSeconds: 9 }),
      g({ id: 2, conceptId: null, name: 'STARFIELD (PS5)', playSeconds: 1 }),
      g({ id: 3, name: 'Other Game', playSeconds: 5 }),
      g({ id: 4, name: 'other game', playSeconds: 2 }),
    ]);
    expect(p.get(2)).toBe(1);
    expect(p.get(4)).toBe(3);
    expect(p.has(1)).toBe(false);
  });
  it('скрытые и not_duplicate не склеиваются; уже стоявшие ссылки снимаются', () => {
    const p = planDuplicates([
      g({ id: 1, conceptId: 'c', playSeconds: 9 }),
      g({ id: 2, conceptId: 'c', notDuplicate: true, duplicateOf: 1 }),
      g({ id: 3, conceptId: 'c', hidden: true, duplicateOf: 1 }),
    ]);
    expect(p.get(2)).toBeNull();
    expect(p.get(3)).toBeNull();
    expect(p.has(1)).toBe(false);
  });
  it('разные игры без общего ключа не склеиваются', () => {
    expect(planDuplicates([g({ id: 1, conceptId: 'a' }), g({ id: 2, conceptId: 'b' })]).size).toBe(0);
  });
});

describe('mergeDuplicateSnapshots (чистая)', () => {
  const snap = (gameId: number, date: string, seconds: number) => ({ gameId, date, seconds });
  it('сумма версий, до первого снимка версии берётся её первое значение', () => {
    const out = mergeDuplicateSnapshots([snap(1, '2026-01-01', 100), snap(1, '2026-03-01', 200), snap(2, '2026-02-01', 50), snap(9, '2026-01-01', 7)], new Map([[2, 1]]));
    const by = (id: number) => out.filter((s) => s.gameId === id).sort((a, b) => a.date.localeCompare(b.date)).map((s) => [s.date, s.seconds]);
    expect(by(1)).toEqual([['2026-01-01', 150], ['2026-02-01', 150], ['2026-03-01', 250]]);
    expect(by(9)).toEqual([['2026-01-01', 7]]);
    expect(out.some((s) => s.gameId === 2)).toBe(false);
  });
  it('без дублей возвращает то же', () => {
    const s = [snap(1, '2026-01-01', 1)];
    expect(mergeDuplicateSnapshots(s, new Map())).toEqual(s);
  });
});

describe('дубли в БД: PS4 + PS5, изоляция, «Это не дубль»', () => {
  let t: TestDb;
  const ids: Record<number, { ps4: number; ps5: number; solo: number; set: number }> = {};

  beforeAll(async () => {
    t = await createTestDb();
    holder.db = t.db;
    await t.db.execute(sql.raw(`insert into allowed_users (email, role, status) values ('b@example.com', 'member', 'active')`));
  });
  afterAll(() => t.close());

  beforeEach(async () => {
    await t.reset();
    resetTestSession();
    holder.db = t.db;
    await seed(A);
    await seed(B);
  });

  async function seed(u: typeof A): Promise<void> {
    const base = { userId: u, lastSeenAt: NOW, psnGenres: ['ACTION', 'RPG'], conceptId: 'CONCEPT_1' };
    const [ps4] = await t.db.insert(games).values({ ...base, titleId: 'PS4T', name: 'Dual Game', category: 'ps4_game', playDurationSeconds: 3600, lastPlayedAt: new Date('2026-09-01T10:00:00Z') }).returning({ id: games.id });
    const [ps5] = await t.db.insert(games).values({ ...base, titleId: 'PS5T', name: 'Dual Game', category: 'ps5_native_game', playDurationSeconds: 7200, lastPlayedAt: new Date('2026-10-01T10:00:00Z') }).returning({ id: games.id });
    const [solo] = await t.db.insert(games).values({ userId: u, titleId: 'SOLO', name: 'Solo', category: 'ps5_native_game', lastSeenAt: NOW, psnGenres: ['RACING'], playDurationSeconds: 1800 }).returning({ id: games.id });
    await t.db.insert(gameStatus).values([
      { userId: u, gameId: ps4.id, status: 'backlog' },
      { userId: u, gameId: solo.id, status: 'backlog' },
    ]);
    await t.db.insert(playtimeSnapshots).values([
      { userId: u, gameId: ps4.id, snapshotDate: '2026-01-10', playDurationSeconds: 1000 },
      { userId: u, gameId: ps4.id, snapshotDate: '2026-06-10', playDurationSeconds: 3600 },
      { userId: u, gameId: ps5.id, snapshotDate: '2026-01-10', playDurationSeconds: 0 },
      { userId: u, gameId: ps5.id, snapshotDate: '2026-10-10', playDurationSeconds: 7200 },
      { userId: u, gameId: solo.id, snapshotDate: '2026-01-10', playDurationSeconds: 0 },
      { userId: u, gameId: solo.id, snapshotDate: '2026-10-10', playDurationSeconds: 1800 },
    ]);
    // один общий сет у обеих версий (как linkByConcept) и по трофею
    const [set] = await t.db.insert(trophySets).values({ userId: u, npCommunicationId: 'NPWR_D', npServiceName: 'trophy', name: 'Dual set', definedBronze: 2, earnedBronze: 1, definedPlatinum: 1 }).returning({ id: trophySets.id });
    await t.db.insert(gameTrophySets).values([
      { userId: u, gameId: ps4.id, trophySetId: set.id, source: 'title_id' },
      { userId: u, gameId: ps5.id, trophySetId: set.id, source: 'concept' },
    ]);
    await t.db.insert(trophies).values([
      { userId: u, trophySetId: set.id, trophyId: 0, type: 'bronze', name: 'T0', earned: true, earnedAt: new Date('2026-05-05T10:00:00Z'), earnedRate: '3.00' },
      { userId: u, trophySetId: set.id, trophyId: 1, type: 'platinum', name: 'T1', earned: false, earnedRate: '1.00' },
    ]);
    ids[u] = { ps4: ps4.id, ps5: ps5.id, solo: solo.id, set: set.id };
  }

  const q = () => {
    const p = parseListQuery(new URLSearchParams());
    if (!p.ok) throw new Error(p.message);
    return p.value;
  };
  const stats = (u: typeof A) => getStats(t.db, u, { type: 'year', year: 2026, month: null }, NOW);
  const dupOf = async (id: number) => (await t.db.select({ d: games.duplicateOfGameId, nd: games.notDuplicate }).from(games).where(eq(games.id, id)))[0];

  it('до склейки обе версии видны; после синка одна карточка, часы суммируются, статус и версии', async () => {
    expect((await listGames(t.db, A, q(), NOW)).total).toBe(3);
    expect(await applyDuplicates(t.db, A)).toBe(1);
    expect(await applyDuplicates(t.db, A)).toBe(0); // идемпотентно
    expect(await dupOf(ids[A].ps4)).toEqual({ d: ids[A].ps5, nd: false });
    expect(await dupOf(ids[A].ps5)).toEqual({ d: null, nd: false });

    const list = await listGames(t.db, A, q(), NOW);
    expect(list.total).toBe(2);
    expect(list.counts.all).toBe(2);
    const main = list.items.find((i) => i.id === ids[A].ps5)!;
    expect(main.hours).toBe(3); // 2 ч + 1 ч
    expect(main.platform).toBe('PS5');
    expect(main.linkedVersions).toEqual([{ gameId: ids[A].ps4, title: 'Dual Game', platform: 'PS4', hours: 1 }]);
    expect(list.items.find((i) => i.id === ids[A].solo)!.linkedVersions).toEqual([]);
    // статус PS4 (backlog) скопирован на новую главную
    expect(main.status).toBe('backlog');
    // трофеи не задваиваются: общий сет один раз
    expect(main.trophies?.defined).toBe(3);

    const sum = await getCollectionSummary(t.db, A);
    expect(sum.totals.games).toBe(2);
    expect(sum.totals.playSeconds).toBe(3600 + 7200 + 1800);
    const det = await getGameDetails(t.db, A, ids[A].ps5);
    expect(det?.game.linkedVersions).toHaveLength(1);
    expect(det?.trophyList).toHaveLength(2);
    // окно дубля работает и указывает на главную
    expect((await getGamesByIds(t.db, A, [ids[A].ps4]))[0].duplicateOfGameId).toBe(ids[A].ps5);
  });

  it('сумма часов, трофеи и жанры в статистике не меняются после склейки', async () => {
    const before = await stats(A);
    const wBefore = await getWrapped(t.db, A, 2026, 'x', NOW);
    await applyDuplicates(t.db, A);
    const after = await stats(A);
    expect(after.header.hours).toBe(before.header.hours);
    expect(after.hours.byMonth).toEqual(before.hours.byMonth);
    expect(after.header.platinum).toBe(before.header.platinum);
    expect(after.trophies.counts).toEqual(before.trophies.counts);
    expect(before.header.hours).toBeGreaterThan(0);
    // игра одна: в топе по часам одна запись «Dual Game»
    expect(after.top.byHours.filter((r) => r.game.title === 'Dual Game')).toHaveLength(1);
    expect(before.top.byHours.filter((r) => r.game.title === 'Dual Game')).toHaveLength(2);
    // жанры: вес игры 1 делится по 1/N, склеенная пара весит как одна игра
    const genreHours = (s: typeof after) => s.genres.items.reduce((a, x) => a + x.value, 0);
    expect(genreHours(after)).toBeCloseTo(genreHours(before) - 1, 1);
    const wAfter = await getWrapped(t.db, A, 2026, 'x', NOW);
    expect(wAfter.hours.total).toBe(wBefore.hours.total);
    expect(wAfter.hours.total).toBeGreaterThan(0);
    const act = await getActivity(t.db, A, 2026, NOW);
    expect(act).toBeTruthy();
  });

  it('Бэклог, План, Подскажи не показывают дубль', async () => {
    await applyDuplicates(t.db, A);
    const backlog = await getBacklogEntries(t.db, A);
    // статус PS4 скопирован на главную: в очереди одна запись главной, PS4 не показан
    expect(backlog.filter((e) => e.title === 'Dual Game').map((e) => e.gameId)).toEqual([ids[A].ps5]);
    expect(backlog.map((e) => e.gameId)).toContain(ids[A].solo);
    const cand = await loadCandidates(t.db, A);
    expect(cand.map((c) => c.id)).not.toContain(ids[A].ps4);
  });

  it('изоляция по user_id: склейка A не трогает B и чужие игры', async () => {
    await applyDuplicates(t.db, A);
    expect(await dupOf(ids[B].ps4)).toEqual({ d: null, nd: false });
    expect((await listGames(t.db, B, q(), NOW)).total).toBe(3);
    await applyDuplicates(t.db, B);
    expect(await dupOf(ids[B].ps4)).toEqual({ d: ids[B].ps5, nd: false });
    // чужой id главной БД не принимает (составной FK)
    await expect(t.db.update(games).set({ duplicateOfGameId: ids[B].ps5 }).where(eq(games.id, ids[A].solo))).rejects.toThrow();
    // пользователь не видит и не меняет чужие игры
    testSession.userId = Number(B);
    const res = await notDuplicatePost(new Request(`http://localhost/api/games/${ids[A].ps5}/not-duplicate`, { method: 'POST' }), { params: Promise.resolve({ id: String(ids[A].ps5) }) });
    expect(res.status).toBe(404);
    expect(await dupOf(ids[A].ps4)).toMatchObject({ d: ids[A].ps5 });
  });

  it('POST not-duplicate: отвязывает, ставит флаг, синк не перезаписывает', async () => {
    await applyDuplicates(t.db, A);
    testSession.userId = Number(A);
    const call = (id: number, body?: unknown) =>
      notDuplicatePost(
        new Request(`http://localhost/api/games/${id}/not-duplicate`, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) }),
        { params: Promise.resolve({ id: String(id) }) },
      );
    expect((await call(ids[A].ps5, { versionId: ids[A].solo })).status).toBe(404); // не её дубль
    expect((await call(ids[A].ps5, { versionId: 'x' })).status).toBe(400);
    expect((await call(Number.NaN)).status).toBe(400);
    const res = await call(ids[A].ps5);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { game: { id: number; hours: number; linkedVersions: unknown[] } } };
    expect(body.data.game.id).toBe(ids[A].ps5);
    expect(body.data.game.linkedVersions).toEqual([]);
    expect(body.data.game.hours).toBe(2);
    expect(await dupOf(ids[A].ps4)).toEqual({ d: null, nd: true });
    expect((await call(ids[A].ps5)).status).toBe(200); // идемпотентно
    expect((await listGames(t.db, A, q(), NOW)).total).toBe(3);
    // синк не склеивает снова
    expect(await applyDuplicates(t.db, A)).toBe(0);
    expect(await dupOf(ids[A].ps4)).toEqual({ d: null, nd: true });
    // у пользователя B склейка осталась как была (он ещё не синкал)
    expect(await dupOf(ids[B].ps4)).toEqual({ d: null, nd: false });
  });

  it('POST not-duplicate по id самого дубля и по versionId', async () => {
    await applyDuplicates(t.db, A);
    testSession.userId = Number(A);
    const res = await notDuplicatePost(new Request('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id: String(ids[A].ps4) }) });
    expect(res.status).toBe(200);
    expect(await dupOf(ids[A].ps4)).toEqual({ d: null, nd: true });
    const [row] = await t.db.select({ c: sql<number>`count(*)::int` }).from(gameStatus).where(and(eq(gameStatus.userId, A)));
    expect(row.c).toBeGreaterThan(0);
  });
});
