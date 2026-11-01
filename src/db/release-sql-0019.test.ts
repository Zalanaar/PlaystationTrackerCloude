// docs/release-neon-0019.sql (журнал токена PSN) поверх 0000–0018 на PGlite: идемпотентность, схема = drizzle-миграция 0019,
// журнал, данные целы, check-запрос, повторный drizzle migrate ничего не применяет.
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
const releaseSql = readFileSync(join(process.cwd(), 'docs/release-neon-0019.sql'), 'utf8');
const checkSql = readFileSync(join(process.cwd(), 'docs/release-neon-0019-check.sql'), 'utf8');
const E = journalRaw.entries.findIndex((e) => e.tag === '0019_psn_token_events');

function folderUpTo(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig19-'));
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

async function after0018(): Promise<PGlite> {
  const c = new PGlite();
  await migrate(drizzle(c), { migrationsFolder: folderUpTo(E) });
  await c.exec(`
    insert into allowed_users (email, role, status) values ('o@example.com', 'owner', 'active');
    insert into allowed_users (email, role, status) values ('m@example.com', 'member', 'active');
    insert into games (user_id, title_id, name, category, last_seen_at) values (1, 'X', 'X', 'ps4_game', now());
    insert into login_attempts (ip_hash, success, kind) values ('h', false, 'google');
  `);
  return c;
}

describe('docs/release-neon-0019.sql', () => {
  it('0019 идёт сразу после 0018', () => {
    expect(E).toBeGreaterThan(0);
    expect(journalRaw.entries[E - 1].tag).toBe('0018_game_duplicates');
  });

  it('поверх 0000–0018 дважды: схема как у drizzle, журнал верный, данные целы, check «до/после»', async () => {
    const full = new PGlite();
    await migrate(drizzle(full), { migrationsFolder: folderUpTo(E + 1) });
    const c = await after0018();
    const before = (await c.query<{ t: string; n: number }>(checkSql)).rows;
    await c.exec(releaseSql);
    const once = await schemaDump(c);
    await c.exec(releaseSql);
    expect(await schemaDump(c)).toEqual(once);
    expect(once).toEqual(await schemaDump(full));

    const after = (await c.query<{ t: string; n: number }>(checkSql)).rows;
    const data = (rows: typeof after) => rows.filter((r) => !r.t.startsWith('zz_'));
    expect(data(after)).toEqual(data(before));
    expect(Number(before.find((r) => r.t === 'zz_events_table')?.n)).toBe(0);
    expect(Number(after.find((r) => r.t === 'zz_events_table')?.n)).toBe(1);

    const e = journalRaw.entries[E];
    const hash = createHash('sha256').update(readFileSync(join(root, `${e.tag}.sql`), 'utf8')).digest('hex');
    const j = await c.query<{ hash: string }>('select hash from drizzle.__drizzle_migrations where created_at = $1', [e.when]);
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].hash).toBe(hash);
    const res = (await c.query<Record<string, boolean>>(releaseSql.slice(releaseSql.lastIndexOf('SELECT\n')))).rows[0];
    expect(Object.values(res).every(Boolean)).toBe(true);
  });

  it('ограничения: kind npsso принимается, мусорный нет; event только из четырёх; удаление пользователя обнуляет user_id', async () => {
    const c = await after0018();
    await expect(c.exec(`insert into login_attempts (ip_hash, success, kind) values ('h', false, 'npsso')`)).rejects.toThrow();
    await c.exec(releaseSql);
    await c.exec(`insert into login_attempts (ip_hash, success, kind) values ('h', false, 'npsso')`);
    await expect(c.exec(`insert into login_attempts (ip_hash, success, kind) values ('h', false, 'other')`)).rejects.toThrow();
    await c.exec(`insert into psn_token_events (user_id, event, details) values (2, 'pasted', '{"a":1}'), (null, 'expired', null)`);
    await expect(c.exec(`insert into psn_token_events (event) values ('bad')`)).rejects.toThrow();
    await expect(c.exec(`insert into psn_token_events (user_id, event) values (99, 'pasted')`)).rejects.toThrow();
    await c.exec(`delete from allowed_users where id = 2`);
    expect((await c.query<{ n: number }>(`select count(*)::int as n from psn_token_events where user_id is null`)).rows[0].n).toBe(2);
    expect((await c.query<{ n: number }>(`select count(*)::int as n from login_attempts where kind = 'google'`)).rows[0].n).toBe(1);
  });

  it('после релизного SQL drizzle migrate ничего не применяет повторно', async () => {
    const c = await after0018();
    await c.exec(releaseSql);
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(E + 1) });
    const n = await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(n.rows[0].n).toBe(E + 1);
  });

  it('без login_attempts.kind скрипт останавливается с понятной ошибкой', async () => {
    await expect(new PGlite().exec(releaseSql)).rejects.toThrow(/0019/);
  });
});
