// Фаза 34 (контракт 26) на PGlite: GET /api/games/{id}.history, дубли, изоляция user_id, игра без снимков.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { getGameDetails } from './details';

const { games, gameMonthExclusions, playtimeSnapshots, trophies, trophySets, gameTrophySets } = schema;
const A = TEST_USER;
const B = TEST_USER_2;

describe('getGameDetails: history', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.execute(sql.raw(`insert into allowed_users (email, role, status) values ('b@example.com', 'member', 'active')`));
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function game(userId: typeof A, titleId: string, extra: Partial<typeof games.$inferInsert> = {}) {
    const [g] = await t.db
      .insert(games)
      .values({ userId, titleId, name: titleId, category: 'ps5_native_game', lastSeenAt: new Date('2026-10-30T00:00:00Z'), ...extra })
      .returning({ id: games.id });
    return g.id;
  }
  const snaps = (userId: typeof A, gameId: number, rows: [string, number][]) =>
    t.db.insert(playtimeSnapshots).values(rows.map(([snapshotDate, playDurationSeconds]) => ({ userId, gameId, snapshotDate, playDurationSeconds })));

  it('игра без снимков и трофеев: history null', async () => {
    const id = await game(A, 'EMPTY', { firstPlayedAt: new Date('2026-01-01T00:00:00Z') });
    const d = await getGameDetails(t.db, A, id);
    expect(d?.history).toBeNull();
  });

  it('снимки + оценка + трофеи на одной шкале', async () => {
    const id = await game(A, 'G', { firstPlayedAt: new Date('2026-08-10T10:00:00Z'), lastPlayedAt: new Date('2026-09-02T10:00:00Z') });
    await snaps(A, id, [['2026-09-01', 7200], ['2026-09-02', 7800]]);
    const [set] = await t.db.insert(trophySets).values({ userId: A, npCommunicationId: 'NP', npServiceName: 'trophy2', name: 'G' }).returning({ id: trophySets.id });
    await t.db.insert(gameTrophySets).values({ userId: A, gameId: id, trophySetId: set.id, source: 'title_id' });
    await t.db.insert(trophies).values([
      { userId: A, trophySetId: set.id, trophyId: 0, type: 'platinum', earned: true, earnedAt: new Date('2026-09-02T09:00:00Z') },
      { userId: A, trophySetId: set.id, trophyId: 1, type: 'bronze', earned: false },
    ]);
    const h = (await getGameDetails(t.db, A, id))!.history!;
    expect(h.hasHours).toBe(true);
    expect(h.hasEstimate).toBe(true);
    expect(h.firstSnapshotDate).toBe('2026-09-01');
    expect(h.playedDays).toBe(1);
    expect(h.weeks.reduce((a, w) => a + w.estimatedSeconds, 0)).toBe(7200);
    expect(h.weeks.reduce((a, w) => a + w.seconds, 0)).toBe(7800);
    expect(h.weeks.filter((w) => w.platinum).map((w) => w.weekStart)).toEqual(['2026-08-31']);
  });

  it('дубль: часы версий суммируются в главную, окно дубля считает только дубль', async () => {
    const main = await game(A, 'MAIN', { firstPlayedAt: null });
    const dup = await game(A, 'DUP', { firstPlayedAt: null, duplicateOfGameId: main });
    await snaps(A, main, [['2026-10-05', 1000], ['2026-10-12', 2000]]);
    await snaps(A, dup, [['2026-10-05', 500], ['2026-10-19', 1500]]);
    const h = (await getGameDetails(t.db, A, main))!.history!;
    // слитый ряд: 10-05: 1500, 10-12: 2500, 10-19: 3500
    expect(h.weeks.map((w) => [w.weekStart, w.seconds])).toEqual([['2026-10-12', 1000], ['2026-10-19', 1000]]);
    const hd = (await getGameDetails(t.db, A, dup))!.history!;
    expect(hd.weeks.map((w) => [w.weekStart, w.seconds])).toEqual([['2026-10-19', 1000]]);
  });

  it('исключённый месяц главной (15.1) влияет на оценку', async () => {
    const id = await game(A, 'EX', { firstPlayedAt: new Date('2026-07-20T10:00:00Z'), lastPlayedAt: new Date('2026-08-31T10:00:00Z') });
    await snaps(A, id, [['2026-09-01', 7200]]);
    await t.db.insert(gameMonthExclusions).values({ userId: A, gameId: id, month: '2026-07' });
    const h = (await getGameDetails(t.db, A, id))!.history!;
    expect(h.weeks.reduce((a, w) => a + w.estimatedSeconds, 0)).toBe(7200);
    expect(h.weeks[0].weekStart).toBe('2026-07-27');
  });

  it('изоляция: чужая игра недоступна, чужие снимки в историю не попадают', async () => {
    const a = await game(A, 'SHARED_TITLE');
    await snaps(A, a, [['2026-10-05', 0], ['2026-10-06', 600]]);
    expect(await getGameDetails(t.db, B, a)).toBeNull();
    const b = await game(B, 'SHARED_TITLE');
    await snaps(B, b, [['2026-10-05', 0], ['2026-10-06', 9000]]);
    const h = (await getGameDetails(t.db, A, a))!.history!;
    expect(h.weeks.map((w) => w.seconds)).toEqual([600]);
    const hb = (await getGameDetails(t.db, B, b))!.history!;
    expect(hb.weeks.map((w) => w.seconds)).toEqual([9000]);
  });
});
