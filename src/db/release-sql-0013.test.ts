// QA: docs/release-neon-0013.sql поверх 0000–0012 на PGlite: идемпотентность, схема = drizzle-миграция 0013, журнал, данные целы; owner-SQL.
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'src/db/migrations');
const journalRaw = JSON.parse(readFileSync(join(root, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; when: number; tag: string }[];
};
const releaseSql = readFileSync(join(process.cwd(), 'docs/release-neon-0013.sql'), 'utf8');
const ownerSql = readFileSync(join(process.cwd(), 'docs/release-neon-0013-owner.sql'), 'utf8');

function folderUpTo(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig13-'));
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
  const cons = await c.query<{ s: string }>(
    `select conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) as s from pg_constraint where connamespace='public'::regnamespace order by 1`,
  );
  const idx = await c.query<{ s: string }>(`select indexname||':'||indexdef as s from pg_indexes where schemaname='public' order by 1`);
  return [...cols.rows.map((r) => r.s), ...cons.rows.map((r) => r.s), ...idx.rows.map((r) => r.s)];
}

describe('docs/release-neon-0013.sql', () => {
  it('поверх 0000–0012 дважды: схема как у drizzle, журнал верный, данные целы', async () => {
    const full = new PGlite();
    await migrate(drizzle(full), { migrationsFolder: folderUpTo(14) });
    const c = new PGlite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(13) });
    await c.exec(`insert into login_attempts (ip_hash, success) values ('h', false)`);
    await c.exec(releaseSql);
    const once = await schemaDump(c);
    await c.exec(releaseSql);
    expect(await schemaDump(c)).toEqual(once);
    expect(once).toEqual(await schemaDump(full));
    expect((await c.query('select kind from login_attempts')).rows).toEqual([{ kind: 'password' }]);

    const e = journalRaw.entries[13];
    expect(e.tag).toBe('0013_allowed_users');
    const hash = createHash('sha256').update(readFileSync(join(root, `${e.tag}.sql`), 'utf8')).digest('hex');
    const j = await c.query<{ hash: string }>('select hash from drizzle.__drizzle_migrations where created_at = $1', [e.when]);
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].hash).toBe(hash);
  });

  it('после релизного SQL drizzle migrate ничего не применяет повторно; owner-SQL идемпотентен, id = 1', async () => {
    const c = new PGlite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(13) });
    await c.exec(releaseSql);
    await migrate(drizzle(c), { migrationsFolder: root });
    const n = await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(n.rows[0].n).toBe(journalRaw.entries.length);

    const sql = ownerSql.replaceAll('ВАШ_EMAIL@gmail.com', 'owner@example.com').replaceAll('ВАШ_ONLINE_ID', 'someone');
    await c.exec(sql);
    await c.exec(sql);
    const r = await c.query('select id, role, status, psn_online_id, psn_access_status from allowed_users');
    expect(r.rows).toEqual([{ id: 1, role: 'owner', status: 'active', psn_online_id: 'someone', psn_access_status: 'ok' }]);
  });
});
