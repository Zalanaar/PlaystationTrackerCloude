import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { getStats } from '@/server/stats/query';
import { createTestDb, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { getWrapped } from './query';

const { games, gameStatus, gameTrophySets, playtimeSnapshots, trophies, trophySets } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');

describe('getWrapped (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function game(n: number, o: Partial<typeof games.$inferInsert> = {}) {
    const [g] = await t.db.insert(games).values({ userId: 1, titleId: `CUSA${n}_00`, name: `G${n}`, category: 'ps4_game', lastSeenAt: NOW, ...o }).returning();
    return g.id;
  }

  it('пустая БД: empty, текущий год в списке без данных', async () => {
    const r = await getWrapped(t.db, TEST_USER, 2026, null, NOW);
    expect(r.mode).toBe('empty');
    expect(r.slides).toEqual(['empty']);
    expect(r.years).toEqual([{ year: 2026, hasData: false }]);
    expect(r.emptyState).toEqual({ syncStartedOn: null });
  });

  it('сверка со Статистикой и прямым SQL, платины, годы, граница 31 дек/1 янв МСК', async () => {
    const a = await game(1, { psnGenres: ['ACTION'], playCount: 19 });
    const b = await game(2, { psnGenres: ['PUZZLE'] });
    const c = await game(3);
    await t.db.insert(playtimeSnapshots).values([
      { userId: 1, gameId: a, snapshotDate: '2025-12-31', playDurationSeconds: 3600 },
      { userId: 1, gameId: a, snapshotDate: '2026-10-20', playDurationSeconds: 3600 * 11 },
      { userId: 1, gameId: b, snapshotDate: '2025-12-31', playDurationSeconds: 0 },
      { userId: 1, gameId: b, snapshotDate: '2026-04-01', playDurationSeconds: 3600 * 3 },
      { userId: 1, gameId: c, snapshotDate: '2025-12-31', playDurationSeconds: 100 },
      { userId: 1, gameId: c, snapshotDate: '2026-06-01', playDurationSeconds: 100 },
    ]);
    await t.db.insert(gameStatus).values([
      { userId: 1, gameId: a, status: 'completed', completedAt: new Date('2025-12-31T21:00:00Z') }, // 1 янв 2026 МСК
      { userId: 1, gameId: b, status: 'dropped', droppedAt: new Date('2025-12-31T20:59:59Z') }, // 2025
    ]);
    const [s1] = await t.db.insert(trophySets).values({ userId: 1, npCommunicationId: 'NPWR1', npServiceName: 'trophy', name: 'Set A' }).returning();
    const [s2] = await t.db.insert(trophySets).values({ userId: 1, npCommunicationId: 'NPWR2', npServiceName: 'trophy', name: 'Orphan' }).returning();
    await t.db.insert(gameTrophySets).values([{ userId: 1, gameId: a, trophySetId: s1.id, source: 'api' as never }]).catch(async () => {
      await t.db.execute(sql`insert into game_trophy_sets (user_id, game_id, trophy_set_id, source) select 1, ${a}, ${s1.id}, e.enumlabel::trophy_set_link_source from pg_enum e join pg_type ty on ty.oid = e.enumtypid where ty.typname = 'trophy_set_link_source' limit 1`);
    });
    await t.db.insert(trophies).values([
      { userId: 1, trophySetId: s1.id, trophyId: 0, type: 'platinum', earned: true, earnedAt: new Date('2026-03-01T00:00:00Z'), earnedRate: '4.30', rarity: 1, name: 'P' },
      { userId: 1, trophySetId: s2.id, trophyId: 0, type: 'platinum', earned: true, earnedAt: new Date('2026-09-01T00:00:00Z'), earnedRate: '1.20' },
      { userId: 1, trophySetId: s2.id, trophyId: 1, type: 'gold', earned: true, earnedAt: new Date('2025-12-31T20:59:59Z') },
      { userId: 1, trophySetId: s2.id, trophyId: 2, type: 'gold', earned: true, earnedAt: new Date('2025-12-31T21:00:00Z') },
    ]);

    const w = await getWrapped(t.db, TEST_USER, 2026, 'artem', NOW);
    const st = await getStats(t.db, TEST_USER, { type: 'year', year: 2026, month: null }, NOW);
    expect(w.mode).toBe('story');
    expect(w.profile.onlineId).toBe('artem');
    expect(w.hours.total).toBe(st.header.hours);
    expect(w.hours.byMonth).toEqual(st.hours.byMonth);
    expect(w.trophies.counts).toEqual(st.trophies.counts);
    expect(w.finished.completed.count).toBe(st.header.completed);
    expect(w.finished.dropped.count).toBe(st.header.dropped);
    expect(w.genres.items.map((i) => i.key).sort()).toEqual(['ACTION', 'PUZZLE']);

    // прямой SQL: дельта по играм за 2026
    const r = await t.pg.execute(sql`select sum(e.sec - b.sec) s from (select distinct game_id from playtime_snapshots) g
      join lateral (select play_duration_seconds sec from playtime_snapshots where game_id = g.game_id and snapshot_date <= '2026-12-31' order by snapshot_date desc limit 1) e on true
      join lateral (select play_duration_seconds sec from playtime_snapshots where game_id = g.game_id and snapshot_date < '2026-01-01' order by snapshot_date desc limit 1) b on true`);
    expect(w.hours.total).toBe(Math.round(Number((r.rows[0] as { s: string }).s) / 360) / 10);

    expect(w.topGames.items.map((x) => [x.game.id, x.hours])).toEqual([[a, 10], [b, 3]]);
    expect(w.longestGame).toMatchObject({ hasData: true, hours: 10, playCount: 19 });
    expect(w.longestGame.game?.id).toBe(a);
    expect(w.hours.topMonth).toEqual({ month: 10, hours: 10 });

    expect(w.trophies.platinum.first?.game?.id).toBe(a);
    expect(w.trophies.platinum.first?.earnedRate).toBe(4.3);
    expect(w.trophies.platinum.last?.game).toBeNull(); // сет-сирота
    expect(w.trophies.platinum.last?.setName).toBe('Orphan');
    expect(w.trophies.platinum.rarest?.earnedRate).toBe(1.2);

    expect(w.finished.completed.items.map((i) => i.game.id)).toEqual([a]); // 1 янв МСК
    const w25 = await getWrapped(t.db, TEST_USER, 2025, null, NOW);
    expect(w25.finished.dropped.count).toBe(1);
    expect(w25.finished.completed.count).toBe(0);
    expect(w25.trophies.counts).toMatchObject({ gold: 1, total: 1 }); // 20:59:59Z
    expect(w25.hours.total).toBe(0);
    expect(w25.slides).toEqual(['start', 'finished', 'trophies', 'genres', 'final']);

    expect(w.years.map((y) => y.year)).toEqual([2026, 2025]);
    expect(w.years.every((y) => y.hasData)).toBe(true);

    const w24 = await getWrapped(t.db, TEST_USER, 2024, null, NOW);
    expect(w24.mode).toBe('empty');
    expect(w24.emptyState).toEqual({ syncStartedOn: '2025-12-31' });
  });
});
