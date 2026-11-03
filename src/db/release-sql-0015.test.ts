// QA/backend 20.3: docs/release-neon-0015.sql (contract) поверх 0000–0014 с данными на PGlite: идемпотентность, схема = drizzle-миграция 0015,
// журнал, данные owner целы, второй пользователь с теми же title_id/np_id/snapshots и своими psn_profile/roadmap_settings вставляется,
// B-1 (recommend_reasons), откат docs/release-neon-0015-rollback.sql возвращает схему 0014 без потери данных.
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
const releaseSql = readFileSync(join(process.cwd(), 'docs/release-neon-0015.sql'), 'utf8');
const checkSql = readFileSync(join(process.cwd(), 'docs/release-neon-0015-check.sql'), 'utf8');
const rollbackSql = readFileSync(join(process.cwd(), 'docs/release-neon-0015-rollback.sql'), 'utf8');


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

async function after0014(): Promise<PGlite> {
  const c = await freshPglite();
  await migrate(drizzle(c), { migrationsFolder: folderUpTo(15) });
  return c;
}

const OWNER = `insert into allowed_users (email, role, status) values ('o@example.com', 'owner', 'active')`;
const MEMBER = `insert into allowed_users (email, role, status) values ('m@example.com', 'member', 'active')`;

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
    insert into recommend_dislikes (game_id) values (2);
    insert into recommend_reasons (game_id, signals_hash, text) values (1, 'h1', 'Фраза');
    insert into recommend_llm_usage (day, calls) values ('2026-10-30', 3);
    insert into recommend_discover_cache (day, profile_hash, payload) values ('2026-10-30', 'h', '{}');
    insert into recommend_external_dislikes (external_source, external_id, title) values ('rawg', '1', 'X');
    insert into planned_games (title, external_source, external_id) values ('P', 'rawg', '77');
    insert into status_backups (payload) values ('[]');
  `);
}

/** Строки данных owner в сравнимом виде (user_id всегда 1, ключи не зависят от схемы). */
async function ownerData(c: PGlite): Promise<unknown[]> {
  const q = async (sql: string) => (await c.query(sql)).rows;
  return [
    await q(`select title_id, name, play_duration_seconds, user_id from games order by id`),
    await q(`select game_id, status::text, user_id from game_status order by game_id`),
    await q(`select np_communication_id, earned_bronze, user_id from trophy_sets order by id`),
    await q(`select trophy_id, earned, (earned_at is not null) as has_at, user_id from trophies order by id`),
    await q(`select game_id, snapshot_date::text, play_duration_seconds, user_id from playtime_snapshots order by id`),
    await q(`select online_id, user_id from psn_profile`),
    await q(`select year, hours_per_week, user_id from roadmap_settings`),
    await q(`select day::text, calls, user_id from recommend_llm_usage`),
    await q(`select day::text, profile_hash, user_id from recommend_discover_cache`),
    await q(`select external_source, external_id, user_id from recommend_external_dislikes`),
    await q(`select game_id, signals_hash, text, user_id from recommend_reasons`),
    await q(`select title, external_id, user_id from planned_games`),
  ];
}

describe('docs/release-neon-0015.sql', () => {
  it('поверх 0000–0014 с данными дважды: схема как у drizzle, журнал верный, данные owner целы, check «до/после»', async () => {
    const full = await freshPglite();
    await migrate(drizzle(full), { migrationsFolder: folderUpTo(16) });
    const c = await after0014();
    await seed(c);
    const dataBefore = await ownerData(c);
    const before = (await c.query<{ t: string; n: number; s: number }>(checkSql)).rows;
    await c.exec(releaseSql);
    const once = await schemaDump(c);
    await c.exec(releaseSql);
    expect(await schemaDump(c)).toEqual(once);
    expect(once).toEqual(await schemaDump(full));
    expect(await ownerData(c)).toEqual(dataBefore);

    const after = (await c.query<{ t: string; n: number; s: number }>(checkSql)).rows;
    const data = (rows: typeof after) => rows.filter((r) => !r.t.startsWith('zz_'));
    expect(data(after)).toEqual(data(before));
    const flags = (rows: typeof after) => Object.fromEntries(rows.filter((r) => r.t.startsWith('zz_') && r.t !== 'zz_other_users_rows').map((r) => [r.t, Number(r.n)]));
    expect(Object.values(flags(before)).every((v) => v === 0)).toBe(true);
    expect(Object.values(flags(after)).every((v) => v === 1)).toBe(true);
    expect(Number(after.find((r) => r.t === 'zz_other_users_rows')?.n)).toBe(0);

    const e = journalRaw.entries[15];
    expect(e.tag).toBe('0015_user_id_contract');
    const hash = createHash('sha256').update(readFileSync(join(root, `${e.tag}.sql`), 'utf8')).digest('hex');
    const j = await c.query<{ hash: string }>('select hash from drizzle.__drizzle_migrations where created_at = $1', [e.when]);
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].hash).toBe(hash);
    const res = (await c.query<Record<string, boolean>>(releaseSql.slice(releaseSql.lastIndexOf('SELECT\n')))).rows[0];
    expect(Object.values(res).every(Boolean)).toBe(true);
  });

  it('после релизного SQL drizzle migrate ничего не применяет повторно', async () => {
    const c = await after0014();
    await seed(c);
    await c.exec(releaseSql);
    await migrate(drizzle(c), { migrationsFolder: root });
    const n = await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(n.rows[0].n).toBe(journalRaw.entries.length);
  });

  it('второй пользователь с теми же title_id/np_id/snapshots/external_id и своими psn_profile/roadmap_settings; ключи и FK изолируют', async () => {
    const c = await after0014();
    await seed(c);
    await c.exec(releaseSql);
    await c.exec(MEMBER); // id = 2
    await c.exec(`
      insert into games (user_id, title_id, name, category, last_seen_at) values (2, 'CUSA1', 'A2', 'ps4_game', now());
      insert into trophy_sets (user_id, np_communication_id, np_service_name, name) values (2, 'NPWR1', 'trophy', 'A2');
      insert into game_trophy_sets (user_id, game_id, trophy_set_id, source) values (2, 3, 2, 'title_id');
      insert into trophies (user_id, trophy_set_id, trophy_id, type) values (2, 2, 0, 'bronze');
      insert into playtime_snapshots (user_id, game_id, snapshot_date, play_duration_seconds) values (2, 3, '2026-10-30', 10);
      insert into psn_profile (user_id, online_id) values (2, 'other');
      insert into roadmap_settings (user_id, year, hours_per_week) values (2, 2026, 5);
      insert into recommend_llm_usage (user_id, day, calls) values (2, '2026-10-30', 1);
      insert into recommend_discover_cache (user_id, day, profile_hash, payload) values (2, '2026-10-30', 'h2', '{}');
      insert into recommend_external_dislikes (user_id, external_source, external_id, title) values (2, 'rawg', '1', 'X');
      insert into planned_games (user_id, title, external_source, external_id) values (2, 'P2', 'rawg', '77');
      insert into sync_runs (user_id, kind, snapshot_date, status) values (2, 'manual', '2026-10-30', 'success');
    `);
    // дубли внутри одного пользователя по-прежнему запрещены
    await expect(c.exec(`insert into games (user_id, title_id, name, category, last_seen_at) values (2, 'CUSA1', 'dup', 'ps4_game', now())`)).rejects.toThrow();
    await expect(c.exec(`insert into psn_profile (user_id, online_id) values (2, 'dup')`)).rejects.toThrow();
    await expect(c.exec(`insert into roadmap_settings (user_id, year, hours_per_week) values (1, 2026, 3)`)).rejects.toThrow();
    await expect(c.exec(`insert into recommend_llm_usage (user_id, day, calls) values (1, '2026-10-30', 1)`)).rejects.toThrow();
    await expect(c.exec(`insert into trophies (user_id, trophy_set_id, trophy_id, type) values (2, 2, 0, 'gold')`)).rejects.toThrow();
    await expect(c.exec(`insert into playtime_snapshots (user_id, game_id, snapshot_date, play_duration_seconds) values (2, 3, '2026-10-30', 1)`)).rejects.toThrow();
    // user_id без default
    await expect(c.exec(`insert into games (title_id, name, category, last_seen_at) values ('X','x','ps4_game', now())`)).rejects.toThrow(/user_id/);
    await expect(c.exec(`insert into psn_profile (online_id) values ('x')`)).rejects.toThrow(/user_id/);
    // колонок id больше нет
    await expect(c.exec(`select id from psn_profile`)).rejects.toThrow();
    await expect(c.exec(`select id from roadmap_settings`)).rejects.toThrow();
    // составные FK: чужая игра/сет
    await expect(c.exec(`insert into game_status (user_id, game_id, status) values (1, 3, 'playing')`)).rejects.toThrow();
    await expect(c.exec(`insert into trophies (user_id, trophy_set_id, trophy_id, type) values (1, 2, 9, 'bronze')`)).rejects.toThrow();
    // данные owner не затронуты
    expect((await c.query<{ n: number }>(`select count(*)::int as n from games where user_id = 1`)).rows[0].n).toBe(2);
    expect((await c.query<{ online_id: string }>(`select online_id from psn_profile where user_id = 1`)).rows).toEqual([{ online_id: 'me' }]);
    // каскад удаления пользователя
    await c.exec(`delete from allowed_users where id = 2`);
    for (const t of ['games', 'psn_profile', 'roadmap_settings', 'recommend_llm_usage', 'recommend_discover_cache', 'recommend_external_dislikes', 'planned_games', 'trophy_sets', 'trophies', 'sync_runs']) {
      expect((await c.query<{ n: number }>(`select count(*)::int as n from ${t} where user_id = 2`)).rows[0].n, t).toBe(0);
    }
  });

  it('B-1: кэш фраз пишется ON CONFLICT (user_id, game_id, signals_hash) после 0015; одинаковый хэш у разных пользователей не конфликтует', async () => {
    const c = await after0014();
    await seed(c);
    await c.exec(releaseSql);
    await c.exec(MEMBER);
    await c.exec(`insert into games (user_id, title_id, name, category, last_seen_at) values (2, 'CUSA1', 'A2', 'ps4_game', now())`); // id = 3
    const upsert = (uid: number, gid: number, text: string) =>
      c.exec(`insert into recommend_reasons (user_id, game_id, signals_hash, text) values (${uid}, ${gid}, 'h1', '${text}')
        on conflict (user_id, game_id, signals_hash) do update set text = excluded.text`);
    await upsert(1, 1, 'Новая фраза owner');
    await upsert(2, 3, 'Фраза второго');
    await upsert(2, 3, 'Фраза второго v2');
    const r = await c.query<{ user_id: number; game_id: number; text: string }>(`select user_id, game_id, text from recommend_reasons order by game_id`);
    expect(r.rows).toEqual([
      { user_id: 1, game_id: 1, text: 'Новая фраза owner' },
      { user_id: 2, game_id: 3, text: 'Фраза второго v2' },
    ]);
    // upsert с чужой игрой (user 2, game 1) теперь вставка, а не перезапись строки owner: падает на составном FK
    await expect(upsert(2, 1, 'чужая игра')).rejects.toThrow();
    await expect(c.exec(`insert into recommend_reasons (user_id, game_id, signals_hash, text) values (1, 1, 'h1', '')`)).rejects.toThrow();
  });

  it('пустая БД с owner проходит; без 0014 скрипт останавливается до изменений', async () => {
    const empty = await after0014();
    await empty.exec(releaseSql);
    const old = await freshPglite();
    await migrate(drizzle(old), { migrationsFolder: folderUpTo(14) });
    await expect(old.exec(releaseSql)).rejects.toThrow(/0014/);
  });
});

describe('docs/release-neon-0015-rollback.sql', () => {
  it('возвращает схему 0014 и журнал без потери данных; повторный прогон и повторное применение 0015 работают', async () => {
    const c = await after0014();
    await seed(c);
    const schemaBefore = await schemaDump(c);
    const dataBefore = await ownerData(c);
    await c.exec(releaseSql);
    await c.exec(rollbackSql);
    expect(await schemaDump(c)).toEqual(schemaBefore);
    expect(await ownerData(c)).toEqual(dataBefore);
    expect((await c.query<{ n: number }>(`select count(*)::int as n from drizzle.__drizzle_migrations where created_at = ${journalRaw.entries[15].when}`)).rows[0].n).toBe(0);
    await c.exec(rollbackSql);
    expect(await schemaDump(c)).toEqual(schemaBefore);
    const flags = (await c.query<Record<string, boolean>>(rollbackSql.slice(rollbackSql.lastIndexOf('SELECT\n')))).rows[0];
    expect(Object.values(flags).every(Boolean)).toBe(true);
    // и снова вперёд
    await c.exec(releaseSql);
    await migrate(drizzle(c), { migrationsFolder: root });
    expect((await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations')).rows[0].n).toBe(journalRaw.entries.length);
  });

  it('есть данные второго пользователя: откат останавливается до изменений', async () => {
    const c = await after0014();
    await seed(c);
    await c.exec(releaseSql);
    await c.exec(MEMBER);
    await c.exec(`insert into games (user_id, title_id, name, category, last_seen_at) values (2, 'CUSA1', 'A2', 'ps4_game', now())`);
    const dump = await schemaDump(c);
    await expect(c.exec(rollbackSql)).rejects.toThrow(/откат невозможен/);
    expect(await schemaDump(c)).toEqual(dump);
  });
});
