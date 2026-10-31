// Фаза 8.2: производительность /api/stats с «Играми месяца» на реальном масштабе (214 игр x год снимков).
// Число запросов к БД фиксировано и не зависит от числа игр (без N+1).
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import type { AnyDb } from '@/db/types';
import { getStats } from './query';
import { TEST_USER } from '@/server/sync/test-helpers';

const NOW = new Date('2026-10-27T10:00:00Z');

async function seeded(nGames: number) {
  let queries = 0;
  const client = new PGlite();
  const db = drizzle(client, { schema, logger: { logQuery: () => void queries++ } });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)) });
  // данные одним SQL: nGames игр, ежедневные снимки с 2025-10-28 по 2026-10-27, часть игр завершена
  await client.exec(`insert into allowed_users (email, role, status) values ('owner@example.com', 'owner', 'active')`); // user_id = 1 (0014)
  await client.exec(`
    insert into games (user_id, title_id, name, category, last_seen_at, first_played_at, last_played_at, psn_genres)
    select 1, 'CUSA' || i, 'Game ' || i, 'ps5_native_game', now(), timestamptz '2024-01-01' + (i || ' days')::interval,
           timestamptz '2025-06-01' + (i || ' days')::interval, array['ACTION']
    from generate_series(1, ${nGames}) i;
    insert into playtime_snapshots (user_id, game_id, snapshot_date, play_duration_seconds)
    select 1, g.id, d::date, 3600 * 5 + (extract(epoch from d - timestamp '2025-10-28') / 86400)::int * (g.id % 7) * 60
    from games g, generate_series(timestamp '2025-10-28', timestamp '2026-10-27', interval '1 day') d;
    insert into game_status (user_id, game_id, status, completed_at)
    select 1, id, 'completed', timestamptz '2026-01-15' + (id || ' days')::interval from games where id % 5 = 0;
  `);
  return { db: db as unknown as AnyDb, count: () => queries, reset: () => void (queries = 0), close: () => client.close() };
}

describe('производительность getStats (PGlite)', () => {
  it('214 игр x 365 снимков: год за разумное время, число запросов как у 5 игр', async () => {
    const small = await seeded(5);
    small.reset();
    await getStats(small.db, TEST_USER, { type: 'year', year: 2026, month: null }, NOW);
    const smallQueries = small.count();
    await small.close();

    const big = await seeded(214);
    big.reset();
    const t0 = performance.now();
    const r = await getStats(big.db, TEST_USER, { type: 'year', year: 2026, month: null }, NOW);
    const ms = performance.now() - t0;
    expect(big.count()).toBe(smallQueries);
    expect(r.played.groups).toHaveLength(10); // янв..окт
    expect(r.played.groups[0].items.length).toBeGreaterThan(150);
    // PGlite в памяти медленнее Postgres; порог с большим запасом, ловит только квадратичный регресс
    expect(ms).toBeLessThan(5000);
    await big.close();
  }, 60_000);
});
