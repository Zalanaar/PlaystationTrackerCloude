// Общие помощники тестов миграций и release-neon-*.sql (п. 8): раньше folderUpTo копировалась в 24 файла.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MIGRATIONS_ROOT = join(process.cwd(), 'src/db/migrations');

/** Временная папка миграций: первые count записей журнала репозитория (для `migrate(drizzle(db), { migrationsFolder })`). */
export function folderUpTo(count: number): string {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_ROOT, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  mkdirSync(join(dir, 'meta'));
  const entries = journal.entries.slice(0, count);
  for (const e of entries) cpSync(join(MIGRATIONS_ROOT, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  return dir;
}
