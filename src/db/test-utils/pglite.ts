// Только для тестов (п. 8): быстрый пустой PGlite. initdb внутри `new PGlite()` стоит ~1.2 с на экземпляр, загрузка готового
// каталога данных ~0.25 с. Снимок пустого кластера делается один раз и кешируется в процессе и на диске (tmpdir) для всех файлов тестов.
import { PGlite } from '@electric-sql/pglite';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function pgliteVersion(): string {
  try {
    return (JSON.parse(readFileSync(join(process.cwd(), 'node_modules/@electric-sql/pglite/package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

let empty: Promise<Blob> | null = null;

async function emptySnapshot(): Promise<Blob> {
  const file = join(tmpdir(), `ptc-pglite-empty-${pgliteVersion()}.tar`);
  if (existsSync(file)) {
    try {
      return new Blob([readFileSync(file)]);
    } catch {
      // битый или удалённый снимок: создаём заново
    }
  }
  const db = new PGlite();
  await db.waitReady; // без этого dumpDataDir зависает
  const blob = await db.dumpDataDir('none');
  await db.close();
  const tmp = `${file}.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, Buffer.from(await blob.arrayBuffer()));
  renameSync(tmp, file); // атомарно: параллельные воркеры не читают недописанный файл
  return blob;
}

/** Пустая база PGlite, как `new PGlite()`, но без initdb на каждый тест. */
export async function freshPglite(): Promise<PGlite> {
  empty ??= emptySnapshot();
  const db = new PGlite({ loadDataDir: await empty });
  await db.waitReady;
  return db;
}
