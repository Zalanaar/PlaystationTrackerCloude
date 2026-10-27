import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { getStats } from './query';

const { games, gameStatus, playtimeSnapshots, trophies, trophySets } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');

describe('getStats (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function game(n: number, o: Partial<typeof games.$inferInsert> = {}) {
    const [g] = await t.db.insert(games).values({ titleId: `CUSA${n}_00`, name: `G${n}`, category: 'ps4_game', lastSeenAt: NOW, ...o }).returning();
    return g.id;
  }

  it('пустая БД: все блоки пустые, текущий год в списке', async () => {
    const r = await getStats(t.db, { type: 'year', year: 2026, month: null }, NOW);
    expect(r.years).toEqual([2026]);
    expect(r.header).toEqual({ completed: 0, dropped: 0, hours: null, platinum: 0 });
    expect(r.hours.firstSnapshotDate).toBeNull();
    expect(r.finished.groups).toEqual([]);
  });

  it('данные: часы, трофеи, пройдено, годы, граница месяца', async () => {
    const a = await game(1, { psnGenres: ['ACTION'] });
    const b = await game(2, { psnGenres: ['PUZZLE', 'ADVENTURE'] });
    await t.db.insert(playtimeSnapshots).values([
      { gameId: a, snapshotDate: '2025-12-31', playDurationSeconds: 3600 },
      { gameId: a, snapshotDate: '2026-10-31', playDurationSeconds: 3600 * 4 },
      { gameId: b, snapshotDate: '2026-10-20', playDurationSeconds: 7200 },
    ]);
    // 21:59 UTC = 00:59 МСК 1 ноября -> ноябрь; 20:59 UTC = 23:59 МСК 31 октября -> октябрь
    await t.db.insert(gameStatus).values([
      { gameId: a, status: 'completed', completedAt: new Date('2026-10-31T21:59:00Z') },
      { gameId: b, status: 'dropped', droppedAt: new Date('2026-10-31T20:59:00Z') },
    ]);
    const [s] = await t.db.insert(trophySets).values({ npCommunicationId: 'NPWR1', npServiceName: 'trophy', name: 'x' }).returning();
    await t.db.insert(trophies).values([
      { trophySetId: s.id, trophyId: 0, type: 'platinum', earned: true, earnedAt: new Date('2025-12-31T20:59:00Z') },
      { trophySetId: s.id, trophyId: 1, type: 'gold', earned: true, earnedAt: new Date('2026-06-01T00:00:00Z') },
      { trophySetId: s.id, trophyId: 2, type: 'bronze', earned: true, earnedAt: null },
    ]);

    const oct = await getStats(t.db, { type: 'month', year: 2026, month: 10 }, NOW);
    expect(oct.years).toEqual([2026, 2025]);
    expect(oct.header).toEqual({ completed: 0, dropped: 1, hours: 3, platinum: 0 });
    expect(oct.finished.groups.map((g) => [g.month, g.items.map((i) => i.kind)])).toEqual([['2026-10', ['dropped']]]);

    const nov = await getStats(t.db, { type: 'month', year: 2026, month: 11 }, NOW);
    expect(nov.header.completed).toBe(1);
    expect(nov.header.hours).toBeNull(); // будущий месяц

    const y = await getStats(t.db, { type: 'year', year: 2026, month: null }, NOW);
    expect(y.hours.firstSnapshotDate).toBe('2025-12-31');
    expect(y.hours.byMonth[9]).toBe(3);
    expect(y.hours.periodPartial).toBe(false);
    expect(y.header).toMatchObject({ completed: 1, dropped: 1, hours: 3, platinum: 0 });
    expect(y.trophies.counts).toMatchObject({ gold: 1, total: 1 });
    expect(y.genres.items.map((i) => i.key).sort()).toEqual(['ACTION', 'ADVENTURE', 'PUZZLE']);

    const y25 = await getStats(t.db, { type: 'year', year: 2025, month: null }, NOW);
    expect(y25.header.platinum).toBe(1);
    expect(y25.header.hours).toBe(0);
  });
});
