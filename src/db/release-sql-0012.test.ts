// QA: docs/release-neon-0012.sql поверх 0000–0010 на PGlite: идемпотентность, схема = drizzle-миграция 0012, журнал, данные целы.
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
const releaseSql = readFileSync(join(process.cwd(), 'docs/release-neon-0012.sql'), 'utf8');

function folderUpTo(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig12-'));
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

describe('docs/release-neon-0012.sql', () => {
  it('поверх 0000–0011 дважды: схема как у drizzle, журнал верный, данные целы', async () => {
    const full = new PGlite();
    await migrate(drizzle(full), { migrationsFolder: folderUpTo(13) });

    const c = new PGlite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(12) });
    await c.exec(`insert into recommend_llm_usage (day, calls) values ('2026-10-28', 7)`);
    await c.exec(releaseSql);
    const once = await schemaDump(c);
    await c.exec(releaseSql);
    expect(await schemaDump(c)).toEqual(once);
    expect(once).toEqual(await schemaDump(full));
    // старые счётчики целы, новые колонки получили 0
    expect((await c.query('select calls, phrase_calls, discover_auto_calls, discover_manual_calls from recommend_llm_usage')).rows).toEqual([
      { calls: 7, phrase_calls: 0, discover_auto_calls: 0, discover_manual_calls: 0 },
    ]);

    const e = journalRaw.entries[12];
    expect(e.tag).toBe('0012_llm_budget');
    const hash = createHash('sha256').update(readFileSync(join(root, `${e.tag}.sql`), 'utf8')).digest('hex');
    const j = await c.query<{ hash: string; created_at: string }>('select hash, created_at from drizzle.__drizzle_migrations where created_at = $1', [e.when]);
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].hash).toBe(hash);
  });

  it('после релизного SQL drizzle migrate ничего не применяет повторно; CHECK работают', async () => {
    const c = new PGlite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(12) });
    await c.exec(releaseSql);
    await migrate(drizzle(c), { migrationsFolder: root });
    const n = await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(n.rows[0].n).toBe(journalRaw.entries.length);

    await c.exec(`insert into recommend_llm_state (id, fail_streak) values (1, 2)`);
    await expect(c.exec(`insert into recommend_llm_state (id) values (2)`)).rejects.toThrow();
    await expect(c.exec(`update recommend_llm_state set fail_streak = -1`)).rejects.toThrow();
    await expect(c.exec(`insert into recommend_llm_usage (day, phrase_calls) values ('2026-10-29', -1)`)).rejects.toThrow();
    await expect(c.exec(`insert into recommend_llm_usage (day, discover_manual_calls) values ('2026-10-29', -1)`)).rejects.toThrow();
  });
});
