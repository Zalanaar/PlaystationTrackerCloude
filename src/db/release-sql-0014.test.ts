// QA: docs/release-neon-0014.sql поверх 0000–0013 с данными на PGlite: идемпотентность, схема = drizzle-миграция 0014,
// журнал, данные целы (user_id = 1), составные ключи работают, проверка owner останавливает миграцию, check-запрос.
import { PGlite } from '@electric-sql/pglite';
import { freshPglite } from './test-utils/pglite';
import { folderUpTo } from './test-utils/release';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'src/db/migrations');
const journalRaw = JSON.parse(readFileSync(join(root, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; when: number; tag: string }[];
};
const releaseSql = readFileSync(join(process.cwd(), 'docs/release-neon-0014.sql'), 'utf8');
const checkSql = readFileSync(join(process.cwd(), 'docs/release-neon-0014-check.sql'), 'utf8');


async function schemaDump(c: PGlite): Promise<string[]> {
  const cols = await c.query<{ s: string }>(
    `select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as s from information_schema.columns where table_schema='public' order by 1`,
  );
  const cons = await c.query<{ s: string }>(
    `select conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) as s from pg_constraint where connamespace='public'::regnamespace order by 1`,
  );
  const idx = await c.query<{ s: string }>(`select indexname||':'||indexdef as s from pg_indexes where schemaname='public' order by 1`);
  return [...cols.rows.map((r) => r.s), ...cons.rows.map((r) => r.s), ...idx.rows.map((r) => r.s)];
}

const OWNER = `insert into allowed_users (email, role, status) values ('o@example.com', 'owner', 'active')`;

async function seed(c: PGlite): Promise<void> {
  await c.exec(OWNER);
  await c.exec(`
    insert into games (title_id, name, category, last_seen_at, play_duration_seconds) values ('CUSA1','A','ps4_game', now(), 3600), ('CUSA2','B','ps4_game', now(), 7200);
    insert into game_status (game_id, status) values (1, 'playing');
    insert into trophy_sets (np_communication_id, np_service_name, name, earned_bronze) values ('NPWR1','trophy','A', 5);
    insert into game_trophy_sets (game_id, trophy_set_id, source) values (1, 1, 'title_id');
    insert into trophies (trophy_set_id, trophy_id, type, earned, earned_at) values (1, 0, 'bronze', true, now()), (1, 1, 'gold', false, null);
    insert into sync_runs (kind, snapshot_date) values ('daily', '2026-10-30');
    insert into playtime_snapshots (game_id, snapshot_date, play_duration_seconds) values (1, '2026-10-30', 3600);
    insert into psn_profile (id, online_id) values (1, 'me');
    insert into roadmap_settings (id, year, hours_per_week) values (1, 2026, 10);
    insert into roadmap_order (game_id, position) values (2, 0);
    insert into recommend_llm_usage (day, calls) values ('2026-10-30', 3);
    insert into recommend_discover_cache (day, profile_hash, payload) values ('2026-10-30', 'h', '{}');
    insert into recommend_external_dislikes (external_source, external_id, title) values ('rawg', '1', 'X');
    insert into planned_games (title) values ('P');
    insert into status_backups (payload) values ('[]');
  `);
}

const TABLES = ['games', 'game_status', 'trophy_sets', 'game_trophy_sets', 'trophies', 'playtime_snapshots', 'sync_runs', 'psn_profile', 'status_backups', 'game_month_exclusions', 'roadmap_settings', 'planned_games', 'roadmap_order', 'roadmap_excluded', 'recommend_dislikes', 'recommend_reasons', 'recommend_llm_usage', 'recommend_discover_cache', 'recommend_external_dislikes'];

describe('docs/release-neon-0014.sql', () => {
  it('поверх 0000–0013 с данными дважды: схема как у drizzle, журнал верный, user_id = 1, check-запрос «до» = «после»', async () => {
    const full = await freshPglite();
    await migrate(drizzle(full), { migrationsFolder: folderUpTo(15) });
    const c = await freshPglite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(14) });
    await seed(c);
    const before = (await c.query(checkSql)).rows;
    await c.exec(releaseSql);
    const once = await schemaDump(c);
    await c.exec(releaseSql);
    expect(await schemaDump(c)).toEqual(once);
    expect(once).toEqual(await schemaDump(full));
    expect((await c.query(checkSql)).rows).toEqual(before);
    for (const t of TABLES) {
      const r = await c.query<{ n: number; other: number }>(`select count(*)::int as n, count(*) filter (where user_id <> 1)::int as other from ${t}`);
      expect(r.rows[0].other, t).toBe(0);
    }
    const e = journalRaw.entries[14];
    expect(e.tag).toBe('0014_user_id_expand');
    const hash = createHash('sha256').update(readFileSync(join(root, `${e.tag}.sql`), 'utf8')).digest('hex');
    const j = await c.query<{ hash: string }>('select hash from drizzle.__drizzle_migrations where created_at = $1', [e.when]);
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].hash).toBe(hash);
    const flags = (await c.query<Record<string, boolean>>(releaseSql.slice(releaseSql.lastIndexOf('SELECT\n')))).rows[0];
    expect(Object.values(flags).every(Boolean)).toBe(true);
  });

  it('после релизного SQL drizzle migrate ничего не применяет повторно; составные ключи изолируют пользователей', async () => {
    const c = await freshPglite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(14) });
    await seed(c);
    await c.exec(releaseSql);
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(15) });
    const n = await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(n.rows[0].n).toBe(15);

    await c.exec(`insert into allowed_users (email, role, status) values ('m@example.com', 'member', 'active')`); // id = 2
    // тот же title_id у другого пользователя разрешён только с составным ключом, пока старый unique(title_id) жив — нет (до 0015)
    await expect(c.exec(`insert into games (user_id, title_id, name, category, last_seen_at) values (2, 'CUSA1','A','ps4_game', now())`)).rejects.toThrow();
    // чужая игра по составному FK
    const g = await c.query<{ id: number }>(`insert into games (user_id, title_id, name, category, last_seen_at) values (2, 'CUSA9','Z','ps4_game', now()) returning id`);
    const gid = g.rows[0].id;
    await expect(c.exec(`insert into game_status (game_id, user_id, status) values (${gid}, 1, 'playing')`)).rejects.toThrow();
    await c.exec(`insert into game_status (game_id, user_id, status) values (${gid}, 2, 'playing')`);
    await expect(c.exec(`insert into trophies (user_id, trophy_set_id, trophy_id, type) values (2, 1, 5, 'bronze')`)).rejects.toThrow();
    // каскад по пользователю
    await c.exec(`delete from allowed_users where id = 2`);
    expect((await c.query('select count(*)::int as n from games where user_id = 2')).rows[0]).toEqual({ n: 0 });
    expect((await c.query('select count(*)::int as n from games where user_id = 1')).rows[0]).toEqual({ n: 2 });
  });

  it('данные есть, owner нет: скрипт останавливается до изменений; пустая БД без owner проходит', async () => {
    const c = await freshPglite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(14) });
    await c.exec(`insert into games (title_id, name, category, last_seen_at) values ('CUSA1','A','ps4_game', now())`);
    await expect(c.exec(releaseSql)).rejects.toThrow(/owner/);
    const cols = await c.query(`select 1 from information_schema.columns where table_name='games' and column_name='user_id'`);
    expect(cols.rows).toHaveLength(0);

    const empty = await freshPglite();
    await migrate(drizzle(empty), { migrationsFolder: folderUpTo(14) });
    await empty.exec(releaseSql);
  });
});
