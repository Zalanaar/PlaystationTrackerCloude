// docs/release-neon-0023.sql (значение cancelled в sync_error_reason) поверх 0000–0022 на PGlite: идемпотентность,
// схема = drizzle-миграция 0023, журнал, данные целы, check-запрос, повторный drizzle migrate ничего не применяет.
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
const releaseSql = readFileSync(join(process.cwd(), 'docs/release-neon-0023.sql'), 'utf8');
const checkSql = readFileSync(join(process.cwd(), 'docs/release-neon-0023-check.sql'), 'utf8');
const E = journalRaw.entries.findIndex((e) => e.tag === '0023_sync_cancelled');


async function schemaDump(c: PGlite): Promise<string[]> {
  const cols = await c.query<{ s: string }>(
    `select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as s from information_schema.columns where table_schema='public' order by 1`,
  );
  const cons = await c.query<{ s: string }>(`select conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) as s from pg_constraint where connamespace='public'::regnamespace order by 1`);
  const idx = await c.query<{ s: string }>(`select indexname||':'||indexdef as s from pg_indexes where schemaname='public' order by 1`);
  const enums = await c.query<{ s: string }>(`select t.typname||':'||e.enumlabel as s from pg_enum e join pg_type t on t.oid = e.enumtypid order by t.typname, e.enumsortorder`);
  return [...cols.rows.map((r) => r.s), ...cons.rows.map((r) => r.s), ...idx.rows.map((r) => r.s), ...enums.rows.map((r) => r.s)];
}

async function after0022(): Promise<PGlite> {
  const c = await freshPglite();
  await migrate(drizzle(c), { migrationsFolder: folderUpTo(E) });
  await c.exec(`
    insert into allowed_users (email, role, status) values ('o@example.com', 'owner', 'active');
    insert into games (user_id, title_id, name, category, last_seen_at) values (1, 'X', 'X', 'ps4_game', now());
    insert into sync_runs (user_id, kind, status, error_reason, snapshot_date) values (1, 'manual', 'failed', 'timeout', '2026-10-30');
    insert into sync_runs (user_id, kind, status, snapshot_date) values (1, 'daily', 'success', '2026-10-31');
  `);
  return c;
}

describe('docs/release-neon-0023.sql', () => {
  it('0023 идёт сразу после 0022', () => {
    expect(E).toBeGreaterThan(0);
    expect(journalRaw.entries[E - 1].tag).toBe('0022_roadmap_goal');
  });

  it('поверх 0000–0022 дважды: enum как у drizzle, журнал верный, данные целы, check «до/после»', async () => {
    const full = await freshPglite();
    await migrate(drizzle(full), { migrationsFolder: folderUpTo(E + 1) });
    const c = await after0022();
    const before = (await c.query<{ t: string; n: number }>(checkSql)).rows;
    await c.exec(releaseSql);
    const once = await schemaDump(c);
    await c.exec(releaseSql);
    expect(await schemaDump(c)).toEqual(once);
    expect(once).toEqual(await schemaDump(full));
    expect(once).toContain('sync_error_reason:cancelled');

    const after = (await c.query<{ t: string; n: number }>(checkSql)).rows;
    const data = (rows: typeof after) => rows.filter((r) => !r.t.startsWith('zz_'));
    expect(data(after)).toEqual(data(before));
    expect(Number(before.find((r) => r.t === 'zz_cancelled_enum')?.n)).toBe(0);
    expect(Number(after.find((r) => r.t === 'zz_cancelled_enum')?.n)).toBe(1);

    const e = journalRaw.entries[E];
    const hash = createHash('sha256').update(readFileSync(join(root, `${e.tag}.sql`), 'utf8')).digest('hex');
    const j = await c.query<{ hash: string }>('select hash from drizzle.__drizzle_migrations where created_at = $1', [e.when]);
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].hash).toBe(hash);
    const res = (await c.query<Record<string, boolean>>(releaseSql.slice(releaseSql.lastIndexOf('SELECT\n')))).rows[0];
    expect(Object.values(res).every(Boolean)).toBe(true);
  });

  it('значение cancelled принимается sync_runs', async () => {
    const c = await after0022();
    await c.exec(releaseSql);
    await c.exec(`insert into sync_runs (user_id, kind, status, error_reason, snapshot_date) values (1, 'manual', 'failed', 'cancelled', '2026-11-01')`);
    const r = await c.query<{ n: number }>(`select count(*)::int as n from sync_runs where error_reason = 'cancelled'`);
    expect(r.rows[0].n).toBe(1);
  });

  it('после релизного SQL drizzle migrate ничего не применяет повторно', async () => {
    const c = await after0022();
    await c.exec(releaseSql);
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(E + 1) });
    const n = await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(n.rows[0].n).toBe(E + 1);
  });

  it('без цели года (0022) скрипт останавливается с понятной ошибкой', async () => {
    await expect((await freshPglite()).exec(releaseSql)).rejects.toThrow(/0023/);
  });
});
