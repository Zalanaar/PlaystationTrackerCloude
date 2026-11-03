// docs/release-neon-0022.sql (цель года) поверх 0000–0021 на PGlite: идемпотентность, схема = drizzle-миграция 0022,
// журнал, данные целы, check-запрос, повторный drizzle migrate ничего не применяет.
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
const releaseSql = readFileSync(join(process.cwd(), 'docs/release-neon-0022.sql'), 'utf8');
const checkSql = readFileSync(join(process.cwd(), 'docs/release-neon-0022-check.sql'), 'utf8');
const E = journalRaw.entries.findIndex((e) => e.tag === '0022_roadmap_goal');


async function schemaDump(c: PGlite): Promise<string[]> {
  const cols = await c.query<{ s: string }>(
    `select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as s from information_schema.columns where table_schema='public' order by 1`,
  );
  const cons = await c.query<{ s: string }>(`select conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) as s from pg_constraint where connamespace='public'::regnamespace order by 1`);
  const idx = await c.query<{ s: string }>(`select indexname||':'||indexdef as s from pg_indexes where schemaname='public' order by 1`);
  return [...cols.rows.map((r) => r.s), ...cons.rows.map((r) => r.s), ...idx.rows.map((r) => r.s)];
}

async function after0021(): Promise<PGlite> {
  const c = await freshPglite();
  await migrate(drizzle(c), { migrationsFolder: folderUpTo(E) });
  await c.exec(`
    insert into allowed_users (email, role, status) values ('o@example.com', 'owner', 'active');
    insert into allowed_users (email, role, status) values ('m@example.com', 'member', 'active');
    insert into games (user_id, title_id, name, category, last_seen_at) values (1, 'X', 'X', 'ps4_game', now());
    insert into games (user_id, title_id, name, category, last_seen_at) values (2, 'X', 'X', 'ps4_game', now());
    insert into game_status (game_id, user_id, status) values (1, 1, 'playing');
    insert into roadmap_settings (user_id, year, hours_per_week) values (1, 2026, 10);
  `);
  return c;
}

describe('docs/release-neon-0022.sql', () => {
  it('0022 идёт сразу после 0021', () => {
    expect(E).toBeGreaterThan(0);
    expect(journalRaw.entries[E - 1].tag).toBe('0021_telegram_digest');
  });

  it('поверх 0000–0021 дважды: схема как у drizzle, журнал верный, данные целы, check «до/после»', async () => {
    const full = await freshPglite();
    await migrate(drizzle(full), { migrationsFolder: folderUpTo(E + 1) });
    const c = await after0021();
    const before = (await c.query<{ t: string; n: number }>(checkSql)).rows;
    await c.exec(releaseSql);
    const once = await schemaDump(c);
    await c.exec(releaseSql);
    expect(await schemaDump(c)).toEqual(once);
    expect(once).toEqual(await schemaDump(full));

    const after = (await c.query<{ t: string; n: number }>(checkSql)).rows;
    const data = (rows: typeof after) => rows.filter((r) => !r.t.startsWith('zz_'));
    expect(data(after)).toEqual(data(before));
    expect(Number(before.find((r) => r.t === 'zz_goal_columns')?.n)).toBe(0);
    expect(Number(after.find((r) => r.t === 'zz_goal_columns')?.n)).toBe(2);

    const e = journalRaw.entries[E];
    const hash = createHash('sha256').update(readFileSync(join(root, `${e.tag}.sql`), 'utf8')).digest('hex');
    const j = await c.query<{ hash: string }>('select hash from drizzle.__drizzle_migrations where created_at = $1', [e.when]);
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].hash).toBe(hash);
    const res = (await c.query<Record<string, boolean>>(releaseSql.slice(releaseSql.lastIndexOf('SELECT\n')))).rows[0];
    expect(Object.values(res).every(Boolean)).toBe(true);
  });

  it('существующая строка настроек: цели нет, ограничения работают', async () => {
    const c = await after0021();
    await c.exec(releaseSql);
    const row = (await c.query<{ goal_mode: string | null; goal_count: number | null }>('select goal_mode, goal_count from roadmap_settings where user_id = 1')).rows[0];
    expect(row).toEqual({ goal_mode: null, goal_count: null });
    await c.exec(`update roadmap_settings set goal_mode = 'complete', goal_count = 12 where user_id = 1`);
    await c.exec(`update roadmap_settings set goal_mode = 'backlog_to', goal_count = 0 where user_id = 1`);
    await expect(c.exec(`update roadmap_settings set goal_mode = 'x', goal_count = 5 where user_id = 1`)).rejects.toThrow();
    await expect(c.exec(`update roadmap_settings set goal_mode = 'complete', goal_count = 1001 where user_id = 1`)).rejects.toThrow();
    await expect(c.exec(`update roadmap_settings set goal_mode = 'complete', goal_count = -1 where user_id = 1`)).rejects.toThrow();
    await expect(c.exec(`update roadmap_settings set goal_mode = 'complete', goal_count = null where user_id = 1`)).rejects.toThrow();
    await expect(c.exec(`update roadmap_settings set goal_mode = null, goal_count = 3 where user_id = 1`)).rejects.toThrow();
    await c.exec(`update roadmap_settings set goal_mode = null, goal_count = null where user_id = 1`);
  });

  it('после релизного SQL drizzle migrate ничего не применяет повторно', async () => {
    const c = await after0021();
    await c.exec(releaseSql);
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(E + 1) });
    const n = await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(n.rows[0].n).toBe(E + 1);
  });

  it('без telegram_chats скрипт останавливается с понятной ошибкой', async () => {
    await expect((await freshPglite()).exec(releaseSql)).rejects.toThrow(/0022/);
  });
});
