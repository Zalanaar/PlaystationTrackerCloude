// Фаза 10: genres.gameIds/games и top в getStats на PGlite, без N+1.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { getStats } from './query';

const { games, gameStatus, gameTrophySets, playtimeSnapshots, trophies, trophySets } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');
const H = 3600;

describe('getStats: жанры с играми и топ (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  let n = 0;
  const game = async (name: string, o: Partial<typeof games.$inferInsert> = {}) => {
    n += 1;
    const [g] = await t.db.insert(games).values({ titleId: `T10_${n}`, name, category: 'ps5_native_game', lastSeenAt: NOW, ...o }).returning();
    return g.id;
  };
  const snap = (gameId: number, date: string, seconds: number) => ({ gameId, snapshotDate: date, playDurationSeconds: seconds });
  const year = () => getStats(t.db, { type: 'year', year: 2026, month: null }, NOW);
  const month = () => getStats(t.db, { type: 'month', year: 2026, month: 10 }, NOW);
  async function set(np: string, gameIds: number[]) {
    const [s] = await t.db.insert(trophySets).values({ npCommunicationId: np, npServiceName: 'trophy', name: np }).returning();
    for (const g of gameIds) await t.db.insert(gameTrophySets).values({ gameId: g, trophySetId: s.id, source: 'title_id' });
    return s.id;
  }

  it('пустая БД: пустые блоки', async () => {
    const r = await year();
    expect(r.top).toEqual({ byHours: [], byTrophies: [] });
    expect(r.genres).toEqual({ hasData: false, items: [], games: {} });
  });

  it('top.byHours: за период, порядок, карточки GameItem; скрытые не входят', async () => {
    const a = await game('Alpha', { psnGenres: ['ACTION'], imageUrl: 'https://c/a' });
    const b = await game('Beta', { psnGenres: ['ACTION', 'PUZZLE'] });
    const c = await game('Gamma');
    const hidden = await game('Hidden', { hiddenAt: NOW });
    await t.db.insert(playtimeSnapshots).values([
      snap(a, '2026-09-30', 10 * H), snap(a, '2026-10-20', 12 * H), // за октябрь 2
      snap(b, '2026-09-30', 1 * H), snap(b, '2026-10-20', 6 * H), // 5
      snap(c, '2026-09-30', 7 * H), snap(c, '2026-10-20', 7 * H), // 0
      snap(hidden, '2026-09-30', 0), snap(hidden, '2026-10-20', 50 * H),
    ]);
    const r = await month();
    expect(r.top.byHours.map((x) => [x.game.title, x.hours, x.estimated])).toEqual([['Beta', 5, false], ['Alpha', 2, false]]);
    expect(r.top.byHours[1].game.coverUrl).toBe('https://c/a');

    // жанры: gameIds по секундам периода, словарь
    const act = r.genres.items.find((i) => i.key === 'ACTION');
    expect(act?.gameIds).toEqual([b, a]);
    expect(r.genres.items.find((i) => i.key === 'PUZZLE')?.gameIds).toEqual([b]);
    expect(r.genres.games[String(a)]).toEqual({ id: a, title: 'Alpha', coverUrl: 'https://c/a' });
    expect(r.genres.games[String(hidden)]).toBeUndefined();
  });

  it('top.byHours: оценочная доля помечает estimated', async () => {
    const a = await game('Alpha', { firstPlayedAt: new Date('2026-05-10T10:00:00Z'), lastPlayedAt: new Date('2026-05-20T10:00:00Z') });
    await t.db.insert(playtimeSnapshots).values([snap(a, '2026-10-20', 20 * H), { ...snap(a, '2026-10-21', 21 * H) }]);
    await t.db.update(playtimeSnapshots).set({ lastPlayedAt: new Date('2026-05-20T10:00:00Z') }).where(eq(playtimeSnapshots.gameId, a));
    const r = await year();
    expect(r.top.byHours[0]).toMatchObject({ estimated: true });
    expect(r.top.byHours[0].hours).toBeGreaterThanOrEqual(20);
  });

  it('top.byTrophies: по earned_at периода, очки, сеты-сироты и скрытые игры не входят, сет двух игр = min id', async () => {
    const a = await game('Alpha');
    const b = await game('Beta');
    const hid = await game('Hid', { hiddenAt: NOW });
    const sA = await set('NPWR_A', [a]);
    const sShared = await set('NPWR_S', [b, a]); // min id = a
    const sOrphan = await set('NPWR_O', []);
    const sHid = await set('NPWR_H', [hid]);
    const at = (s: string) => ({ earned: true, earnedAt: new Date(s) });
    await t.db.insert(trophies).values([
      { trophySetId: sA, trophyId: 0, type: 'platinum', ...at('2026-10-05T10:00:00Z') }, // a: 300
      { trophySetId: sA, trophyId: 1, type: 'bronze', ...at('2026-09-05T10:00:00Z') }, // вне октября
      { trophySetId: sShared, trophyId: 0, type: 'gold', ...at('2026-10-06T10:00:00Z') }, // a: +90
      { trophySetId: sShared, trophyId: 1, type: 'silver', earned: false }, // не получен
      { trophySetId: sOrphan, trophyId: 0, type: 'platinum', ...at('2026-10-07T10:00:00Z') },
      { trophySetId: sHid, trophyId: 0, type: 'platinum', ...at('2026-10-08T10:00:00Z') },
    ]);
    const mon = await month();
    expect(mon.top.byTrophies).toHaveLength(1);
    expect(mon.top.byTrophies[0]).toMatchObject({ points: 390, counts: { platinum: 1, gold: 1, silver: 0, bronze: 0, total: 2 } });
    expect(mon.top.byTrophies[0].game.id).toBe(a);
    // header.platinum включает сироту, как и раньше
    expect(mon.header.platinum).toBe(2);
    const yr = await year();
    expect(yr.top.byTrophies[0].points).toBe(390 + 15);
  });

  it('ничья по очкам: lower(title), id', async () => {
    const b = await game('beta');
    const a = await game('Alpha');
    const sb = await set('NPWR_B', [b]);
    const sa = await set('NPWR_A', [a]);
    const at = new Date('2026-10-05T10:00:00Z');
    await t.db.insert(trophies).values([
      { trophySetId: sb, trophyId: 0, type: 'gold', earned: true, earnedAt: at },
      { trophySetId: sa, trophyId: 0, type: 'gold', earned: true, earnedAt: at },
    ]);
    expect((await month()).top.byTrophies.map((x) => x.game.title)).toEqual(['Alpha', 'beta']);
  });

  it('завершённая игра без часов попадает в жанры с 0 секунд, ниже играемых', async () => {
    const played = await game('Played', { psnGenres: ['ACTION'] });
    const done = await game('Done', { psnGenres: ['ACTION'] });
    await t.db.insert(playtimeSnapshots).values([snap(played, '2026-09-30', H), snap(played, '2026-10-20', 2 * H)]);
    await t.db.insert(gameStatus).values({ gameId: done, status: 'completed', completedAt: new Date('2026-10-10T10:00:00Z') });
    const r = await month();
    expect(r.genres.items[0].gameIds).toEqual([played, done]);
    expect(r.top.byHours.map((x) => x.game.id)).toEqual([played]);
  });
});

describe('getStats: число запросов не растёт с числом игр (топ и жанры)', () => {
  async function seeded(nGames: number) {
    let queries = 0;
    const client = new PGlite();
    const db = drizzle(client, { schema, logger: { logQuery: () => void queries++ } });
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)) });
    await client.exec(`
      insert into games (title_id, name, category, last_seen_at, psn_genres)
      select 'X' || i, 'Game ' || i, 'ps5_native_game', now(), array['ACTION','ADVENTURE'] from generate_series(1, ${nGames}) i;
      insert into playtime_snapshots (game_id, snapshot_date, play_duration_seconds)
      select g.id, d::date, 3600 + (extract(epoch from d - timestamp '2026-09-01') / 86400)::int * 600
      from games g, generate_series(timestamp '2026-09-01', timestamp '2026-10-27', interval '1 day') d;
      insert into trophy_sets (np_communication_id, np_service_name, name) select 'NP' || id, 'trophy', 'S' || id from games;
      insert into game_trophy_sets (game_id, trophy_set_id, source) select g.id, s.id, 'title_id' from games g join trophy_sets s on s.np_communication_id = 'NP' || g.id;
      insert into trophies (trophy_set_id, trophy_id, type, earned, earned_at)
      select s.id, k, (array['bronze','silver','gold','platinum'])[1 + k % 4]::trophy_type, true, timestamptz '2026-10-05' + (k || ' hours')::interval
      from trophy_sets s, generate_series(0, 5) k;
    `);
    return { db: db as unknown as AnyDb, count: () => queries, reset: () => void (queries = 0), close: () => client.close() };
  }
  it('5 и 120 игр дают одинаковое число запросов; в ответе топ-10 и ≤50 игр на жанр', async () => {
    const small = await seeded(5);
    small.reset();
    await getStats(small.db, { type: 'month', year: 2026, month: 10 }, NOW);
    const q5 = small.count();
    await small.close();
    const big = await seeded(120);
    big.reset();
    const r = await getStats(big.db, { type: 'month', year: 2026, month: 10 }, NOW);
    expect(big.count()).toBe(q5);
    expect(r.top.byHours).toHaveLength(10);
    expect(r.top.byTrophies).toHaveLength(10);
    expect(r.genres.items[0].gameIds.length).toBeLessThanOrEqual(50);
    expect(Object.keys(r.genres.games).length).toBeLessThanOrEqual(50);
    await big.close();
  }, 60_000);
});
