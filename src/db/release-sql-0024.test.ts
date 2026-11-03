// docs/release-neon-0024.sql (таблица owned_marks) поверх 0000–0023 на PGlite: идемпотентность, схема = drizzle-миграция 0024,
// журнал, данные целы, check-запрос, ограничения (изоляция по user_id, 1 -> много, каскады), повторный drizzle migrate ничего не применяет.
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
const releaseSql = readFileSync(join(process.cwd(), 'docs/release-neon-0024.sql'), 'utf8');
const checkSql = readFileSync(join(process.cwd(), 'docs/release-neon-0024-check.sql'), 'utf8');
const E = journalRaw.entries.findIndex((e) => e.tag === '0024_owned_marks');


async function schemaDump(c: PGlite): Promise<string[]> {
  const cols = await c.query<{ s: string }>(
    `select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as s from information_schema.columns where table_schema='public' order by 1`,
  );
  const cons = await c.query<{ s: string }>(`select conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) as s from pg_constraint where connamespace='public'::regnamespace order by 1`);
  const idx = await c.query<{ s: string }>(`select indexname||':'||indexdef as s from pg_indexes where schemaname='public' order by 1`);
  return [...cols.rows.map((r) => r.s), ...cons.rows.map((r) => r.s), ...idx.rows.map((r) => r.s)];
}

async function after0023(): Promise<PGlite> {
  const c = await freshPglite();
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

const count = async (c: PGlite): Promise<number> => (await c.query<{ n: number }>(`select count(*)::int as n from owned_marks`)).rows[0].n;

describe('docs/release-neon-0024.sql', () => {
  it('0024 идёт сразу после 0023', () => {
    expect(E).toBeGreaterThan(0);
    expect(journalRaw.entries[E - 1].tag).toBe('0023_sync_cancelled');
  });

  it('поверх 0000–0023 дважды: схема как у drizzle, журнал верный, данные целы, check «до/после»', async () => {
    const full = await freshPglite();
    await migrate(drizzle(full), { migrationsFolder: folderUpTo(E + 1) });
    const c = await after0023();
    const before = (await c.query<{ t: string; n: number }>(checkSql)).rows;
    await c.exec(releaseSql);
    const once = await schemaDump(c);
    await c.exec(releaseSql);
    expect(await schemaDump(c)).toEqual(once);
    expect(once).toEqual(await schemaDump(full));

    const after = (await c.query<{ t: string; n: number }>(checkSql)).rows;
    const data = (rows: typeof after) => rows.filter((r) => !r.t.startsWith('zz_'));
    expect(data(after)).toEqual(data(before));
    expect(Number(before.find((r) => r.t === 'zz_owned_marks_table')?.n)).toBe(0);
    expect(Number(after.find((r) => r.t === 'zz_owned_marks_table')?.n)).toBe(1);

    const e = journalRaw.entries[E];
    const hash = createHash('sha256').update(readFileSync(join(root, `${e.tag}.sql`), 'utf8')).digest('hex');
    const j = await c.query<{ hash: string }>('select hash from drizzle.__drizzle_migrations where created_at = $1', [e.when]);
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].hash).toBe(hash);
    const res = (await c.query<Record<string, boolean>>(releaseSql.slice(releaseSql.lastIndexOf('SELECT\n')))).rows[0];
    expect(Object.values(res).every(Boolean)).toBe(true);
  });

  it('ограничения: уникальность (user_id, rawg_id), 1 -> много, чужая игра нельзя, covered => не completed, каскады', async () => {
    const c = await after0023();
    await c.exec(releaseSql);
    const ins = (user: number, rawg: string, game: string, completed = 'false') =>
      c.exec(`insert into owned_marks (user_id, rawg_id, title, title_key, covered_by_game_id, completed) values (${user}, '${rawg}', 'T', 't', ${game}, ${completed})`);
    await ins(1, '10', '1');
    await ins(1, '11', '1'); // одна игра покрывает много
    await ins(1, '12', 'null', 'true');
    await expect(ins(1, '10', 'null')).rejects.toThrow(); // PK
    await ins(2, '10', '2'); // тот же rawg_id у другого пользователя
    await expect(ins(1, '13', '2')).rejects.toThrow(); // игра 2 чужая
    await expect(ins(1, '14', '1', 'true')).rejects.toThrow(); // covered + completed
    await expect(c.exec(`insert into owned_marks (user_id, rawg_id, title, title_key) values (1, '15', '', 'x')`)).rejects.toThrow(); // пустое название
    expect(await count(c)).toBe(4);
    await c.exec(`delete from games where id = 1`); // отметки covered уходят, not_in_library остаётся
    expect(await count(c)).toBe(2);
    await c.exec(`delete from allowed_users where id = 2`);
    expect(await count(c)).toBe(1);
  });

  it('после релизного SQL drizzle migrate ничего не применяет повторно', async () => {
    const c = await after0023();
    await c.exec(releaseSql);
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(E + 1) });
    const n = await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(n.rows[0].n).toBe(E + 1);
  });

  it('без 0023 скрипт останавливается с понятной ошибкой', async () => {
    await expect((await freshPglite()).exec(releaseSql)).rejects.toThrow(/0024/);
  });
});
