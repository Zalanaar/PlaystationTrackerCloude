// «Входящие» на PGlite (контракт Фазы 28): пусто, полно, границы окон, DLC-платина, изоляция user_id, частичный сбой, роут.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';

const holder: { db: TestDb['db'] | null } = { db: null };
const flags = { failHints: false };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('no db');
    return holder.db;
  },
}));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);
vi.mock('@/server/sync/status-hints-db', async (orig) => {
  const m = await orig<typeof import('@/server/sync/status-hints-db')>();
  return { ...m, countStatusHints: (...a: Parameters<typeof m.countStatusHints>) => (flags.failHints ? Promise.reject(new Error('boom')) : m.countStatusHints(...a)) };
});

import { GET } from '@/app/api/inbox/route';
import { getInbox } from './query';

const { games, gameStatus, trophies, trophySets, gameTrophySets, playtimeSnapshots, syncRuns } = schema;
const A = TEST_USER;
const B = TEST_USER_2;
const NOW = new Date('2026-11-01T12:00:00Z');
const hAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const dAgo = (d: number) => hAgo(d * 24);

describe('inbox (БД)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    holder.db = t.db;
    await t.db.execute(sql.raw(`insert into allowed_users (email, role, status) values ('b@example.com', 'member', 'active')`));
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    resetTestSession();
    flags.failHints = false;
  });

  async function game(userId: typeof A, titleId: string, extra: Partial<typeof games.$inferInsert> = {}) {
    const [g] = await t.db.insert(games).values({ userId, titleId, name: titleId, category: 'ps5_native_game', lastSeenAt: NOW, firstSeenAt: dAgo(60), ...extra }).returning({ id: games.id });
    return g.id;
  }
  async function earn(userId: typeof A, gameId: number, np: string, list: { type: 'platinum' | 'gold' | 'bronze'; at: Date | null; earned?: boolean }[]) {
    const [s] = await t.db.insert(trophySets).values({ userId, npCommunicationId: np, npServiceName: 'trophy2', name: np }).returning({ id: trophySets.id });
    await t.db.insert(gameTrophySets).values({ userId, gameId, trophySetId: s.id, source: 'title_id' });
    let i = 0;
    for (const x of list) await t.db.insert(trophies).values({ userId, trophySetId: s.id, trophyId: i++, type: x.type, earned: x.earned ?? x.at !== null, earnedAt: x.at });
  }
  const snap = (userId: typeof A, gameId: number, date: string, seconds: number) => t.db.insert(playtimeSnapshots).values({ userId, gameId, snapshotDate: date, playDurationSeconds: seconds });
  const run = (userId: typeof A, at: Date) => t.db.insert(syncRuns).values({ userId, kind: 'daily', status: 'success', snapshotDate: '2026-08-01', startedAt: at, finishedAt: new Date(at.getTime() + 600_000) });

  it('пусто: всё нули, isEmpty', async () => {
    const r = await getInbox(t.db, A, NOW);
    expect(r).toMatchObject({ newGames: 0, newGamesWindow: null, newUnsorted: 0, trophies: 0, platinums: 0, trophiesWindow: null, checkCount: 0, forgottenCount: 0, hoursWeek: null, hoursPrevWeek: null, hoursNoHistory: true, partial: false, failed: [], isEmpty: true });
  });

  it('полно: новые игры, трофеи, часы, подсказки, забытые', async () => {
    await run(A, dAgo(60));
    const old = await game(A, 'OLD', { playDurationSeconds: 10, lastPlayedAt: dAgo(200) }); // забытая
    const n1 = await game(A, 'NEW1', { firstSeenAt: hAgo(5), playDurationSeconds: 7200, lastPlayedAt: hAgo(2) }); // новая, без статуса -> подсказка «Играю?»
    await game(A, 'NEW2', { firstSeenAt: dAgo(3) }); // новая только в 7d
    await game(A, 'HID', { firstSeenAt: hAgo(1), hiddenAt: hAgo(1) });
    await earn(A, old, 'NP1', [{ type: 'platinum', at: hAgo(3) }, { type: 'gold', at: hAgo(30) }, { type: 'bronze', at: hAgo(1) }, { type: 'bronze', at: null, earned: false }]);
    await snap(A, n1, '2026-10-10', 0);
    await snap(A, n1, '2026-10-24', 3600);
    await snap(A, n1, '2026-11-01', 3600 + 7200);
    const r = await getInbox(t.db, A, NOW);
    expect(r).toMatchObject({ newGames: 1, newGamesWindow: '24h', newUnsorted: 1, trophies: 2, platinums: 1, trophiesWindow: '24h', hoursWeek: 2, hoursPrevWeek: 1, hoursNoHistory: false, checkCount: 1, forgottenCount: 1, isEmpty: false });
  });

  it('24 ч пусто -> окно 7 дн.', async () => {
    await run(A, dAgo(60));
    await game(A, 'NEW2', { firstSeenAt: dAgo(3) });
    await game(A, 'NEW3', { firstSeenAt: dAgo(4) });
    const g = await game(A, 'T', { firstSeenAt: dAgo(60) });
    await earn(A, g, 'NPT', [{ type: 'platinum', at: dAgo(2) }, { type: 'gold', at: dAgo(5) }, { type: 'bronze', at: dAgo(9) }]);
    expect(await getInbox(t.db, A, NOW)).toMatchObject({ newGames: 2, newGamesWindow: '7d', newUnsorted: 2, trophies: 2, platinums: 1, trophiesWindow: '7d' });
  });

  it('первичный импорт не считается новыми', async () => {
    await run(A, hAgo(20));
    await game(A, 'FIRST1', { firstSeenAt: hAgo(20) });
    await game(A, 'FIRST2', { firstSeenAt: hAgo(19.9) }); // внутри первого запуска (+10 мин)
    await game(A, 'LATER', { firstSeenAt: hAgo(2) });
    expect((await getInbox(t.db, A, NOW)).newGames).toBe(1);
  });

  it('без sync_runs: база = первая игра + 1 ч', async () => {
    await game(A, 'F1', { firstSeenAt: hAgo(10) });
    await game(A, 'F2', { firstSeenAt: hAgo(9.5) });
    await game(A, 'N', { firstSeenAt: hAgo(5) });
    expect((await getInbox(t.db, A, NOW)).newGames).toBe(1);
  });

  it('граница окна: ровно -24 ч не входит, на миллисекунду позже входит', async () => {
    await run(A, dAgo(60));
    await game(A, 'EDGE', { firstSeenAt: hAgo(24) });
    await game(A, 'IN', { firstSeenAt: new Date(hAgo(24).getTime() + 1) });
    const [s] = await t.db.insert(trophySets).values({ userId: A, npCommunicationId: 'E', npServiceName: 'trophy2', name: 'E' }).returning({ id: trophySets.id });
    await t.db.insert(trophies).values([
      { userId: A, trophySetId: s.id, trophyId: 0, type: 'bronze', earned: true, earnedAt: hAgo(24) },
      { userId: A, trophySetId: s.id, trophyId: 1, type: 'bronze', earned: true, earnedAt: new Date(hAgo(24).getTime() + 1) },
      { userId: A, trophySetId: s.id, trophyId: 2, type: 'bronze', earned: true, earnedAt: NOW },
    ]);
    const r = await getInbox(t.db, A, NOW);
    expect(r).toMatchObject({ newGames: 1, newGamesWindow: '24h', trophies: 2, trophiesWindow: '24h' });
  });

  it('DLC-платина и платина базы: две платины, не схлопываются; PS4 и PS5 тоже раздельно', async () => {
    await run(A, dAgo(60));
    const g = await game(A, 'BASE');
    await earn(A, g, 'BASE', [{ type: 'platinum', at: hAgo(4) }]);
    await earn(A, g, 'DLC', [{ type: 'platinum', at: hAgo(3) }]);
    expect(await getInbox(t.db, A, NOW)).toMatchObject({ platinums: 2, trophies: 2 });
  });

  it('трофеи скрытой игры не считаются', async () => {
    await run(A, dAgo(60));
    const g = await game(A, 'H', { hiddenAt: dAgo(1) });
    await earn(A, g, 'H', [{ type: 'gold', at: hAgo(1) }]);
    expect((await getInbox(t.db, A, NOW)).trophies).toBe(0);
  });

  it('дубль: часы и «разобрать» считаются по главной', async () => {
    await run(A, dAgo(60));
    const main = await game(A, 'M', { conceptId: 'c' });
    const dup = await game(A, 'D', { conceptId: 'c', duplicateOfGameId: main });
    await snap(A, main, '2026-10-01', 0);
    await snap(A, dup, '2026-10-01', 0);
    await snap(A, main, '2026-11-01', 3600);
    await snap(A, dup, '2026-11-01', 3600);
    const r = await getInbox(t.db, A, NOW);
    expect(r.hoursWeek).toBe(2);
    expect(r.hoursPrevWeek).toBe(0);

  });

  it('newUnsorted: новая игра со статусом не входит в «Разобрать»', async () => {
    await run(A, dAgo(60));
    const g = await game(A, 'S', { firstSeenAt: hAgo(3) });
    await game(A, 'U', { firstSeenAt: hAgo(2) });
    await t.db.insert(gameStatus).values({ userId: A, gameId: g, status: 'backlog', statusChangedAt: dAgo(1) });
    expect(await getInbox(t.db, A, NOW)).toMatchObject({ newGames: 2, newUnsorted: 1 });
  });

  it('изоляция: данные второго пользователя не попадают в ответ первого и наоборот', async () => {
    await run(A, dAgo(60));
    await run(B, dAgo(60));
    const a = await game(A, 'SAME', { firstSeenAt: hAgo(2), playDurationSeconds: 5, lastPlayedAt: dAgo(300) });
    const b1 = await game(B, 'SAME', { firstSeenAt: hAgo(2), playDurationSeconds: 5, lastPlayedAt: dAgo(300) });
    const b2 = await game(B, 'ONLYB', { firstSeenAt: hAgo(1) });
    await earn(B, b1, 'NPB', [{ type: 'platinum', at: hAgo(1) }, { type: 'gold', at: hAgo(2) }]);
    await snap(B, b2, '2026-10-01', 0);
    await snap(B, b2, '2026-11-01', 36_000);
    const ra = await getInbox(t.db, A, NOW);
    expect(ra).toMatchObject({ newGames: 1, newUnsorted: 1, trophies: 0, platinums: 0, hoursNoHistory: true, hoursWeek: null, forgottenCount: 1 });
    const rb = await getInbox(t.db, B, NOW);
    expect(rb).toMatchObject({ newGames: 2, newUnsorted: 2, trophies: 2, platinums: 1, hoursWeek: 10, forgottenCount: 1 });
    expect(a).not.toBe(b1);
  });

  it('сбой одной части: null + failed + partial, остальное считается', async () => {
    await run(A, dAgo(60));
    await game(A, 'N', { firstSeenAt: hAgo(1) });
    flags.failHints = true;
    const r = await getInbox(t.db, A, NOW);
    expect(r).toMatchObject({ checkCount: null, partial: true, failed: ['checkCount'], isEmpty: false, newGames: 1 });
  });

  it('роут: 401 без сессии, 200 и сессионный пользователь', async () => {
    await run(A, dAgo(60));
    await run(B, dAgo(60));
    await game(B, 'B1', { firstSeenAt: new Date(Date.now() - 3_600_000) });
    const get = () => GET(new Request('http://localhost/api/inbox'));
    testSession.anonymous = true;
    expect((await get()).status).toBe(401);
    testSession.anonymous = false;
    const a = (await (await get()).json()) as { ok: boolean; data: { newGames: number; isEmpty: boolean } };
    expect(a.data).toMatchObject({ isEmpty: true, newGames: 0 });
    testSession.userId = 2;
    const b = (await (await get()).json()) as typeof a;
    expect(b.data).toMatchObject({ isEmpty: false, newGames: 1 });
  });
});
