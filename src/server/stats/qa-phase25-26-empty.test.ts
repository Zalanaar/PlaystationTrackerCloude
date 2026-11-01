// QA Фаза 25-26: пустая БД и пользователь без данных (рядом с пользователем с данными) для period=all / year=all.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@/db';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { getStats } from './query';
import { getWrapped } from '@/server/wrapped/query';

const { games, gameStatus, playtimeSnapshots, trophySets, trophies, gameTrophySets } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');

describe('QA: пустые данные', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.execute(sql.raw(`insert into allowed_users (email, role, status) values ('b@example.com', 'member', 'active')`));
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function checkEmpty(u: typeof TEST_USER) {
    for (const q of [{ type: 'all' as const, year: 2026, month: null }, { type: 'year' as const, year: 2026, month: null }, { type: 'month' as const, year: 2026, month: 10 }]) {
      const s = await getStats(t.db, u, q, NOW);
      expect(s.header.hours).toBeNull();
      expect(s.trophies.counts.total).toBe(0);
      expect(s.playPattern?.hasData).toBe(false);
      expect(s.playPattern?.total).toBe(0);
      expect(s.playPattern?.peakHour).toBeNull();
      expect(s.playPattern?.byHour).toHaveLength(24);
      expect(s.playPattern?.byWeekday).toHaveLength(7);
      expect(JSON.stringify(s)).not.toMatch(/NaN|Infinity/);
    }
    const sa = await getStats(t.db, u, { type: 'all', year: 2026, month: null }, NOW);
    expect(sa.period).toMatchObject({ type: 'all', from: null, to: null, fromUtc: null, toUtc: null });
    expect(sa.hours.unattributed ?? 0).toBe(0);
    for (const y of ['all', 2026] as const) {
      const w = await getWrapped(t.db, u, y, null, NOW);
      expect(w.mode).toBe('empty');
      expect(w.slides).toEqual(['empty']);
      expect(w.allTimeAvailable).toBe(false);
      expect(w.playPattern?.hasData).toBe(false);
      expect(JSON.stringify(w)).not.toMatch(/NaN|Infinity/);
    }
  }

  it('пустая БД', async () => {
    await checkEmpty(TEST_USER);
  });

  it('пользователь B без данных, у A данные: ни следа A, пусто', async () => {
    const base = { userId: TEST_USER, lastSeenAt: NOW, psnGenres: ['ACTION'] };
    const [g] = await t.db.insert(games).values({ ...base, titleId: 'A1', name: 'LEAK_A', category: 'ps5_native_game', playDurationSeconds: 72000, firstPlayedAt: new Date('2024-01-01T10:00:00Z') }).returning({ id: games.id });
    await t.db.insert(playtimeSnapshots).values({ userId: TEST_USER, gameId: g.id, snapshotDate: '2026-10-20', playDurationSeconds: 72000 });
    await t.db.insert(gameStatus).values({ userId: TEST_USER, gameId: g.id, status: 'completed', completedAt: new Date('2025-05-05T10:00:00Z') });
    const [set] = await t.db.insert(trophySets).values({ userId: TEST_USER, npCommunicationId: 'NPWR_L', npServiceName: 'trophy', name: 'LEAK_A set', definedBronze: 30 }).returning({ id: trophySets.id });
    await t.db.insert(gameTrophySets).values({ userId: TEST_USER, gameId: g.id, trophySetId: set.id, source: 'title_id' });
    await t.db.insert(trophies).values(Array.from({ length: 25 }, (_, i) => ({ userId: TEST_USER, trophySetId: set.id, trophyId: i, type: 'bronze' as const, name: `B${i}`, earned: true, earnedAt: new Date(Date.UTC(2025, 5, 1, 19, i)) })));
    const a = await getStats(t.db, TEST_USER, { type: 'all', year: 2026, month: null }, NOW);
    expect(a.playPattern?.hasData).toBe(true);
    expect(a.header.hours).toBe(20);
    expect((await getWrapped(t.db, TEST_USER, 'all', null, NOW)).allTimeAvailable).toBe(true);
    await checkEmpty(TEST_USER_2);
    const wb = await getWrapped(t.db, TEST_USER_2, 'all', null, NOW);
    expect(JSON.stringify(wb)).not.toContain('LEAK_A');
  });
});
