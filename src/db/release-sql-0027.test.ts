// docs/release-neon-0027.sql (Фаза 45: allowed_users.session_epoch и revoked_sessions) поверх 0000–0026 на PGlite: идемпотентность, схема = drizzle-миграция 0027,
// журнал, данные целы, check-запрос, ограничения (PK sid, каскад), повторный drizzle migrate ничего не применяет.
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
const releaseSql = readFileSync(join(process.cwd(), 'docs/release-neon-0027.sql'), 'utf8');
const checkSql = readFileSync(join(process.cwd(), 'docs/release-neon-0027-check.sql'), 'utf8');
const E = journalRaw.entries.findIndex((e) => e.tag === '0027_session_revocation');


async function schemaDump(c: PGlite): Promise<string[]> {
  const cols = await c.query<{ s: string }>(
    `select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as s from information_schema.columns where table_schema='public' order by 1`,
  );
  const cons = await c.query<{ s: string }>(`select conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) as s from pg_constraint where connamespace='public'::regnamespace order by 1`);
  const idx = await c.query<{ s: string }>(`select indexname||':'||indexdef as s from pg_indexes where schemaname='public' order by 1`);
  return [...cols.rows.map((r) => r.s), ...cons.rows.map((r) => r.s), ...idx.rows.map((r) => r.s)];
}

async function after0026(): Promise<PGlite> {
  const c = await freshPglite();
  await migrate(drizzle(c), { migrationsFolder: folderUpTo(E) });
  await c.exec(`
    insert into allowed_users (email, role, status) values ('o@example.com', 'owner', 'active');
    insert into allowed_users (email, role, status) values ('m@example.com', 'member', 'active');
    insert into games (user_id, title_id, name, category, last_seen_at) values (1, 'X', 'X', 'ps4_game', now());
    insert into games (user_id, title_id, name, category, last_seen_at) values (2, 'X', 'X', 'ps4_game', now());
    insert into game_status (game_id, user_id, status) values (1, 1, 'playing');
    insert into manual_games (user_id, rawg_id, title, kind) values (1, '10', 'T', 'ps_backlog');
  `);
  return c;
}

const count = async (c: PGlite): Promise<number> => (await c.query<{ n: number }>(`select count(*)::int as n from revoked_sessions`)).rows[0].n;

describe('docs/release-neon-0027.sql', () => {
  it('0027 идёт сразу после 0026', () => {
    expect(E).toBeGreaterThan(0);
    expect(journalRaw.entries[E - 1].tag).toBe('0026_manual_games');
  });

  it('поверх 0000–0026 дважды: схема как у drizzle, журнал верный, данные целы, check «до/после»', async () => {
    const full = await freshPglite();
    await migrate(drizzle(full), { migrationsFolder: folderUpTo(E + 1) });
    const c = await after0026();
    const before = (await c.query<{ t: string; n: number }>(checkSql)).rows;
    await c.exec(releaseSql);
    const once = await schemaDump(c);
    await c.exec(releaseSql);
    expect(await schemaDump(c)).toEqual(once);
    expect(once).toEqual(await schemaDump(full));

    const after = (await c.query<{ t: string; n: number }>(checkSql)).rows;
    const data = (rows: typeof after) => rows.filter((r) => !r.t.startsWith('zz_'));
    expect(data(after)).toEqual(data(before));
    for (const k of ['zz_session_epoch_column', 'zz_revoked_sessions_table']) {
      expect(Number(before.find((r) => r.t === k)?.n), k).toBe(0);
      expect(Number(after.find((r) => r.t === k)?.n), k).toBe(1);
    }
    const epochs = await c.query<{ e: number }>(`select session_epoch as e from allowed_users order by id`);
    expect(epochs.rows.map((r) => r.e)).toEqual([0, 0]);

    const e = journalRaw.entries[E];
    const hash = createHash('sha256').update(readFileSync(join(root, `${e.tag}.sql`), 'utf8')).digest('hex');
    const j = await c.query<{ hash: string }>('select hash from drizzle.__drizzle_migrations where created_at = $1', [e.when]);
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].hash).toBe(hash);
    const res = (await c.query<Record<string, boolean>>(releaseSql.slice(releaseSql.lastIndexOf('SELECT\n')))).rows[0];
    expect(Object.values(res).every(Boolean)).toBe(true);
  });

  it('ограничения: sid уникален, пользователь должен существовать, каскад при удалении', async () => {
    const c = await after0026();
    await c.exec(releaseSql);
    const ins = (sid: string, user: number) => c.exec(`insert into revoked_sessions (sid, user_id, expires_at) values ('${sid}', ${user}, now() + interval '1 day')`);
    await ins('a', 1);
    await ins('b', 2);
    await expect(ins('a', 2)).rejects.toThrow();
    await expect(ins('c', 99)).rejects.toThrow();
    await expect(c.exec(`update allowed_users set session_epoch = null where id = 1`)).rejects.toThrow();
    expect(await count(c)).toBe(2);
    await c.exec(`delete from allowed_users where id = 2`);
    expect(await count(c)).toBe(1);
  });

  it('после релизного SQL drizzle migrate ничего не применяет повторно', async () => {
    const c = await after0026();
    await c.exec(releaseSql);
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(E + 1) });
    const n = await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(n.rows[0].n).toBe(E + 1);
  });

  it('без 0026 скрипт останавливается с понятной ошибкой', async () => {
    await expect((await freshPglite()).exec(releaseSql)).rejects.toThrow(/0027/);
  });
});
