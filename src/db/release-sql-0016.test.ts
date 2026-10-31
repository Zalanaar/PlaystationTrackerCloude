// docs/release-neon-0016.sql (прогресс тура) поверх 0000–0015 на PGlite: идемпотентность, схема = drizzle-миграция 0016,
// журнал, данные пользователей целы, check-запрос, повторный drizzle migrate ничего не применяет.
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
const releaseSql = readFileSync(join(process.cwd(), 'docs/release-neon-0016.sql'), 'utf8');
const checkSql = readFileSync(join(process.cwd(), 'docs/release-neon-0016-check.sql'), 'utf8');
const E = journalRaw.entries.findIndex((e) => e.tag === '0016_tour_progress');

function folderUpTo(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig16-'));
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

async function after0015(): Promise<PGlite> {
  const c = new PGlite();
  await migrate(drizzle(c), { migrationsFolder: folderUpTo(E) });
  await c.exec(`
    insert into allowed_users (email, role, status, onboarded_at) values ('o@example.com', 'owner', 'active', null);
    insert into allowed_users (email, role, status, onboarded_at) values ('m@example.com', 'member', 'active', now());
  `);
  return c;
}

describe('docs/release-neon-0016.sql', () => {
  it('0016 последняя в журнале на момент написания и идёт сразу после 0015', () => {
    expect(E).toBeGreaterThan(0);
    expect(journalRaw.entries[E - 1].tag).toBe('0015_user_id_contract');
  });

  it('поверх 0000–0015 дважды: схема как у drizzle, журнал верный, данные целы, существующим tour_version = 1, check «до/после»', async () => {
    const full = new PGlite();
    await migrate(drizzle(full), { migrationsFolder: folderUpTo(E + 1) });
    const c = await after0015();
    const users = () => c.query(`select id, email, role, status, onboarded_at is not null as onb from allowed_users order by id`);
    const usersBefore = (await users()).rows;
    const before = (await c.query<{ t: string; n: number }>(checkSql)).rows;
    await c.exec(releaseSql);
    const once = await schemaDump(c);
    await c.exec(releaseSql);
    expect(await schemaDump(c)).toEqual(once);
    expect(once).toEqual(await schemaDump(full));
    expect((await users()).rows).toEqual(usersBefore); // id/email/role/status/onboarded не изменились

    const after = (await c.query<{ t: string; n: number }>(checkSql)).rows;
    const data = (rows: typeof after) => rows.filter((r) => !r.t.startsWith('zz_'));
    expect(data(after)).toEqual(data(before));
    expect(Number(before.find((r) => r.t === 'zz_tour_columns')?.n)).toBe(0);
    expect(Number(after.find((r) => r.t === 'zz_tour_columns')?.n)).toBe(2);

    // существующим (owner и member) проставлено tour_version = 1, tour_completed_at не пуст
    const marked = await c.query<{ n: number }>(`select count(*)::int as n from allowed_users where tour_version = 1 and tour_completed_at is not null`);
    expect(marked.rows[0].n).toBe(2);

    const e = journalRaw.entries[E];
    const hash = createHash('sha256').update(readFileSync(join(root, `${e.tag}.sql`), 'utf8')).digest('hex');
    const j = await c.query<{ hash: string }>('select hash from drizzle.__drizzle_migrations where created_at = $1', [e.when]);
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].hash).toBe(hash);
    const res = (await c.query<Record<string, boolean>>(releaseSql.slice(releaseSql.lastIndexOf('SELECT\n')))).rows[0];
    expect(Object.values(res).every(Boolean)).toBe(true);
  });

  it('после релизного SQL drizzle migrate ничего не применяет повторно', async () => {
    const c = await after0015();
    await c.exec(releaseSql);
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(E + 1) });
    const n = await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(n.rows[0].n).toBe(E + 1);
  });

  it('повторный запуск не трогает пользователей, созданных после выкладки', async () => {
    const c = await after0015();
    await c.exec(releaseSql);
    await c.exec(`insert into allowed_users (email, role, status) values ('new@example.com', 'member', 'active')`);
    await c.exec(releaseSql);
    const r = await c.query<{ tour_version: number | null }>(`select tour_version from allowed_users where email = 'new@example.com'`);
    expect(r.rows[0].tour_version).toBeNull();
  });

  it('без allowed_users скрипт останавливается с понятной ошибкой', async () => {
    await expect(new PGlite().exec(releaseSql)).rejects.toThrow(/0016/);
  });
});
