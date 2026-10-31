// QA: docs/release-neon-0007.sql поверх 0000–0005 на PGlite: идемпотентность, схема = drizzle-миграция 0006, журнал, данные целы.
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
const releaseSql = readFileSync(join(process.cwd(), 'docs/release-neon-0007.sql'), 'utf8');

function folderUpTo(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig7-'));
  mkdirSync(join(dir, 'meta'));
  const entries = journalRaw.entries.slice(0, count);
  for (const e of entries) cpSync(join(root, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...journalRaw, entries }));
  return dir;
}

describe('docs/release-neon-0007.sql', () => {
  it('дважды подряд, значение hltb есть, drizzle migrate потом ничего не применяет', async () => {
    const c = new PGlite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(7) });
    await c.exec(releaseSql);
    await c.exec(releaseSql);
    const e = await c.query<{ n: number }>(`select count(*)::int as n from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'sync_run_kind' and e.enumlabel = 'hltb'`);
    expect(e.rows[0].n).toBe(1);
    const entry = journalRaw.entries[7];
    const hash = createHash('sha256').update(readFileSync(join(root, `${entry.tag}.sql`), 'utf8')).digest('hex');
    const j = await c.query<{ hash: string }>('select hash from drizzle.__drizzle_migrations where created_at = $1', [entry.when]);
    expect(j.rows).toEqual([{ hash }]);
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(15) });
    const n = await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(n.rows[0].n).toBe(15);
  });
});
