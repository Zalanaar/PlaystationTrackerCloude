// QA: docs/release-neon-0011.sql поверх 0000–0010 на PGlite: идемпотентность, схема = drizzle-миграция 0011, журнал, данные целы.
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
const releaseSql = readFileSync(join(process.cwd(), 'docs/release-neon-0011.sql'), 'utf8');

function folderUpTo(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig11-'));
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
  return [...cols.rows.map((r) => r.s), ...cons.rows.map((r) => r.s)];
}

describe('docs/release-neon-0011.sql', () => {
  it('поверх 0000–0010 дважды: схема как у drizzle, журнал верный, данные целы', async () => {
    const full = new PGlite();
    await migrate(drizzle(full), { migrationsFolder: folderUpTo(12) });

    const c = new PGlite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(11) });
    await c.exec(`insert into games (title_id, name, category, last_seen_at) values ('CUSA1','Игра','ps4_game', now())`);
    await c.exec(releaseSql);
    const once = await schemaDump(c);
    await c.exec(releaseSql);
    expect(await schemaDump(c)).toEqual(once);
    expect(once).toEqual(await schemaDump(full));
    expect((await c.query('select name from games')).rows).toEqual([{ name: 'Игра' }]);

    const e = journalRaw.entries[11];
    expect(e.tag).toBe('0011_recommend_discover');
    const hash = createHash('sha256').update(readFileSync(join(root, `${e.tag}.sql`), 'utf8')).digest('hex');
    const j = await c.query<{ hash: string; created_at: string }>('select hash, created_at from drizzle.__drizzle_migrations where created_at = $1', [e.when]);
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].hash).toBe(hash);
  });

  it('после релизного SQL drizzle migrate ничего не применяет повторно; PK и CHECK работают', async () => {
    const c = new PGlite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(11) });
    await c.exec(releaseSql);
    await migrate(drizzle(c), { migrationsFolder: root });
    const n = await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(n.rows[0].n).toBe(journalRaw.entries.length);

    await c.exec(`insert into recommend_discover_cache (day, profile_hash, payload) values ('2026-10-29', 'h', '{"candidates":[]}')`);
    await expect(c.exec(`insert into recommend_discover_cache (day, profile_hash, payload) values ('2026-10-29', 'h2', '{}')`)).rejects.toThrow();
    await expect(c.exec(`insert into recommend_discover_cache (day, profile_hash, payload, refreshes) values ('2026-10-30', 'h', '{}', -1)`)).rejects.toThrow();

    await c.exec(`insert into recommend_external_dislikes (external_source, external_id, title) values ('rawg', '1', 'Hades')`);
    await expect(c.exec(`insert into recommend_external_dislikes (external_source, external_id, title) values ('rawg', '1', 'Дубль')`)).rejects.toThrow();
    await expect(c.exec(`insert into recommend_external_dislikes (external_source, external_id, title) values ('igdb', '2', 'X')`)).rejects.toThrow();
    await expect(c.exec(`insert into recommend_external_dislikes (external_source, external_id, title) values ('rawg', '3', '')`)).rejects.toThrow();
    await expect(c.exec(`insert into recommend_external_dislikes (external_source, external_id, title) values ('rawg', '4', '${'x'.repeat(201)}')`)).rejects.toThrow();
  });
});
