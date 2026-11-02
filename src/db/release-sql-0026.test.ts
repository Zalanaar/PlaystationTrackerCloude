// docs/release-neon-0026.sql (таблица owned_marks) поверх 0000–0025 на PGlite: идемпотентность, схема = drizzle-миграция 0024,
// журнал, данные целы, check-запрос, ограничения (изоляция по user_id, уникальность, CHECK, каскады), повторный drizzle migrate ничего не применяет.
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'src/db/migrations');
const journalRaw = JSON.parse(readFileSync(join(root, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; when: number; tag: string }[];
};
const releaseSql = readFileSync(join(process.cwd(), 'docs/release-neon-0026.sql'), 'utf8');
const checkSql = readFileSync(join(process.cwd(), 'docs/release-neon-0026-check.sql'), 'utf8');
const E = journalRaw.entries.findIndex((e) => e.tag === '0026_manual_games');

function folderUpTo(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig26-'));
  mkdirSync(join(dir, 'meta'));
  const entries = journalRaw.entries.slice(0, count);
  for (const e of entries) cpSync(join(root, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...journalRaw, entries }));
  return dir;
}

async function schemaDump(c: PGlite): Promise<string[]> {
  const cols = await c.query<{ s: string }>(
    `select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as s from information_schema.columns where table_schema='public' order by 1`,
  );
  const cons = await c.query<{ s: string }>(`select conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) as s from pg_constraint where connamespace='public'::regnamespace order by 1`);
  const idx = await c.query<{ s: string }>(`select indexname||':'||indexdef as s from pg_indexes where schemaname='public' order by 1`);
  return [...cols.rows.map((r) => r.s), ...cons.rows.map((r) => r.s), ...idx.rows.map((r) => r.s)];
}

async function after0025(): Promise<PGlite> {
  const c = new PGlite();
  await migrate(drizzle(c), { migrationsFolder: folderUpTo(E) });
  await c.exec(`
    insert into allowed_users (email, role, status) values ('o@example.com', 'owner', 'active');
    insert into allowed_users (email, role, status) values ('m@example.com', 'member', 'active');
    insert into games (user_id, title_id, name, category, last_seen_at) values (1, 'X', 'X', 'ps4_game', now());
    insert into games (user_id, title_id, name, category, last_seen_at) values (2, 'X', 'X', 'ps4_game', now());
    insert into game_status (game_id, user_id, status) values (1, 1, 'playing');
  `);
  return c;
}

const count = async (c: PGlite): Promise<number> => (await c.query<{ n: number }>(`select count(*)::int as n from manual_games`)).rows[0].n;

describe('docs/release-neon-0026.sql', () => {
  it('0026 идёт сразу после 0025', () => {
    expect(E).toBeGreaterThan(0);
    expect(journalRaw.entries[E - 1].tag).toBe('0025_psn_profiles');
  });

  it('поверх 0000–0025 дважды: схема как у drizzle, журнал верный, данные целы, check «до/после»', async () => {
    const full = new PGlite();
    await migrate(drizzle(full), { migrationsFolder: folderUpTo(E + 1) });
    const c = await after0025();
    const before = (await c.query<{ t: string; n: number }>(checkSql)).rows;
    await c.exec(releaseSql);
    const once = await schemaDump(c);
    await c.exec(releaseSql);
    expect(await schemaDump(c)).toEqual(once);
    expect(once).toEqual(await schemaDump(full));

    const after = (await c.query<{ t: string; n: number }>(checkSql)).rows;
    const data = (rows: typeof after) => rows.filter((r) => !r.t.startsWith('zz_'));
    expect(data(after)).toEqual(data(before));
    expect(Number(before.find((r) => r.t === 'zz_manual_games_table')?.n)).toBe(0);
    expect(Number(after.find((r) => r.t === 'zz_manual_games_table')?.n)).toBe(1);

    const e = journalRaw.entries[E];
    const hash = createHash('sha256').update(readFileSync(join(root, `${e.tag}.sql`), 'utf8')).digest('hex');
    const j = await c.query<{ hash: string }>('select hash from drizzle.__drizzle_migrations where created_at = $1', [e.when]);
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].hash).toBe(hash);
    const res = (await c.query<Record<string, boolean>>(releaseSql.slice(releaseSql.lastIndexOf('SELECT\n')))).rows[0];
    expect(Object.values(res).every(Boolean)).toBe(true);
  });

  it('ограничения: уникальность (user, rawg, kind), CHECK, чужая игра нельзя, каскады', async () => {
    const c = await after0025();
    await c.exec(releaseSql);
    const ins = (user: number, rawg: string, kind = 'ps_backlog', extra = 'not_purchased', val = 'true') =>
      c.exec(`insert into manual_games (user_id, rawg_id, title, kind, ${extra}) values (${user}, '${rawg}', 'T', '${kind}', ${val})`);
    await ins(1, '10');
    await expect(ins(1, '10')).rejects.toThrow(); // уникальность
    await ins(1, '10', 'other_platform', 'not_purchased', 'false'); // тот же rawg_id, другой вид
    await ins(2, '10'); // другой пользователь
    await expect(ins(1, '11', 'other_platform', 'not_purchased', 'true')).rejects.toThrow(); // «не куплено» только у ps_backlog
    await expect(ins(1, '12', 'xbox')).rejects.toThrow(); // вид вне списка
    await expect(c.exec(`insert into manual_games (user_id, rawg_id, title, kind) values (1, '13', '', 'ps_backlog')`)).rejects.toThrow(); // пустое название
    await expect(c.exec(`insert into manual_games (user_id, rawg_id, title, kind, platform_label) values (1, '14', 'T', 'other_platform', '')`)).rejects.toThrow();
    // связь только со своей игрой, «связано» и «не куплено» несовместимы
    await expect(ins(1, '15', 'ps_backlog', 'linked_game_id', '2')).rejects.toThrow(); // игра 2 чужая
    await expect(ins(1, '16', 'ps_backlog', 'suggested_game_id', '2')).rejects.toThrow();
    await expect(c.exec(`insert into manual_games (user_id, rawg_id, title, kind, not_purchased, linked_game_id) values (1, '17', 'T', 'ps_backlog', true, 1)`)).rejects.toThrow(); // «не куплено» при связи
    await c.exec(`insert into manual_games (user_id, rawg_id, title, kind, linked_game_id) values (1, '18', 'T', 'ps_backlog', 1)`);
    expect(await count(c)).toBe(4);
    await c.exec(`delete from games where id = 1`); // связанная запись уходит вместе с игрой
    expect(await count(c)).toBe(3);
    await c.exec(`delete from allowed_users where id = 2`);
    expect(await count(c)).toBe(2);
  });

  it('после релизного SQL drizzle migrate ничего не применяет повторно', async () => {
    const c = await after0025();
    await c.exec(releaseSql);
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(E + 1) });
    const n = await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(n.rows[0].n).toBe(E + 1);
  });

  it('без 0025 скрипт останавливается с понятной ошибкой', async () => {
    await expect(new PGlite().exec(releaseSql)).rejects.toThrow(/0026/);
  });
});
