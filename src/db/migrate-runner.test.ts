// Фаза 46: раннер миграций для CI на PGlite. Журнал совместим с ручными release-neon-*.sql (0000–0027), сверка журнала, по транзакции на миграцию, DATA LOSS.
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPending, checkJournal, diffFingerprints, inspect, LEGACY_LAST_IDX, loadMigrations, renderPlan, schemaFingerprint, type SqlClient } from './migrate-runner';

const root = join(process.cwd(), 'src/db/migrations');
const journal = JSON.parse(readFileSync(join(root, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; when: number; tag: string; version: string; breakpoints: boolean }[] };

function client(db: PGlite): SqlClient {
  return { query: async (t, p) => ({ rows: (await db.query(t, p)).rows as never[] }), run: async (t) => void (await db.exec(t)) };
}

/** Папка: первые count миграций репозитория + дополнительные (tag, sql). */
function folder(count: number, extra: { sql: string; when?: number }[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'migci-'));
  mkdirSync(join(dir, 'meta'));
  const entries = journal.entries.slice(0, count);
  for (const e of entries) cpSync(join(root, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  let when = entries[entries.length - 1]?.when ?? 1;
  extra.forEach((x, i) => {
    const idx = count + i;
    const tag = `${String(idx).padStart(4, '0')}_extra_${i}`;
    when = x.when ?? when + 1000;
    writeFileSync(join(dir, `${tag}.sql`), x.sql);
    entries.push({ idx, when, tag, version: '7', breakpoints: true });
  });
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  return dir;
}

/** Как прод сейчас: 0000–0026 мигратором drizzle, 0027 — ручной release-neon-0027.sql из SQL Editor. */
async function prodLike(): Promise<PGlite> {
  const db = new PGlite();
  await migrate(drizzle(db), { migrationsFolder: folder(LEGACY_LAST_IDX) });
  await db.exec(readFileSync(join(process.cwd(), 'docs/release-neon-0027.sql'), 'utf8'));
  return db;
}

describe('журнал репозитория', () => {
  it('when строго растут, idx по порядку, новые удаляющие миграции помечены DATA LOSS', () => {
    expect(checkJournal(loadMigrations(root))).toEqual([]);
  });

  it('ловит when не по порядку и удаление без пометки', () => {
    const ms = loadMigrations(folder(LEGACY_LAST_IDX + 1, [{ sql: 'ALTER TABLE "games" DROP COLUMN "x";', when: 1 }]));
    const errs = checkJournal(ms);
    expect(errs.some((e) => e.includes('не больше предыдущего'))).toBe(true);
    expect(errs.some((e) => e.includes('DATA LOSS'))).toBe(true);
  });
});

describe('раннер на базе как у прода', () => {
  it('ручной журнал 0000–0027 принимается: ничего не ждёт, ошибок и предупреждений нет, схема как у миграций', async () => {
    const db = await prodLike();
    const ins = await inspect(client(db), loadMigrations(root));
    expect(ins.errors).toEqual([]);
    expect(ins.warnings).toEqual([]);
    expect(ins.applied).toHaveLength(journal.entries.length);
    expect(ins.pending).toEqual([]);
    expect(await applyPending(client(db), loadMigrations(root))).toEqual([]);

    const ref = new PGlite();
    await applyPending(client(ref), loadMigrations(root), { allowDataLoss: true });
    expect(diffFingerprints(await schemaFingerprint(client(ref)), await schemaFingerprint(client(db)))).toEqual({ missing: [], extra: [] });
  });

  it('новая миграция применяется одна, повтор ничего не делает, план = её SQL + запись журнала', async () => {
    const db = await prodLike();
    const ms = loadMigrations(folder(LEGACY_LAST_IDX + 1, [{ sql: 'ALTER TABLE "games" ADD COLUMN "ci_flag" boolean DEFAULT false NOT NULL;' }]));
    const ins = await inspect(client(db), ms);
    expect(ins.pending.map((m) => m.tag)).toEqual(['0028_extra_0']);
    const plan = renderPlan(ins.pending);
    expect(plan).toContain('ADD COLUMN "ci_flag"');
    expect(plan).toContain(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('${ins.pending[0].hash}', ${ins.pending[0].when})`);
    expect((await applyPending(client(db), ms)).map((m) => m.tag)).toEqual(['0028_extra_0']);
    expect(await applyPending(client(db), ms)).toEqual([]);
    const j = await db.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(j.rows[0].n).toBe(journal.entries.length + 1);
  });

  it('стандартный мигратор drizzle на том же журнале тоже видит только новую миграцию (совместимость)', async () => {
    const db = await prodLike();
    await migrate(drizzle(db), { migrationsFolder: folder(LEGACY_LAST_IDX + 1, [{ sql: 'CREATE TABLE "ci_probe" ("id" serial PRIMARY KEY);' }]) });
    const r = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_name = 'ci_probe'`);
    expect(r.rows[0].n).toBe(1);
  });

  it('ошибка во второй миграции: первая остаётся применённой, вторая откатывается целиком, журнал без неё', async () => {
    const db = await prodLike();
    const ms = loadMigrations(
      folder(LEGACY_LAST_IDX + 1, [
        { sql: 'CREATE TABLE "ci_ok" ("id" serial PRIMARY KEY);' },
        { sql: 'CREATE TABLE "ci_half" ("id" serial PRIMARY KEY);\n--> statement-breakpoint\nALTER TABLE "nope" ADD COLUMN "x" int;' },
      ]),
    );
    await expect(applyPending(client(db), ms)).rejects.toThrow(/0029_extra_1 не применена/);
    const t = await db.query<{ name: string }>(`select table_name as name from information_schema.tables where table_name like 'ci_%' order by 1`);
    expect(t.rows.map((r) => r.name)).toEqual(['ci_ok']);
    const ins = await inspect(client(db), ms);
    expect(ins.pending.map((m) => m.tag)).toEqual(['0029_extra_1']);
    expect(ins.errors).toEqual([]);
  });

  it('ADD VALUE enum в одной миграции и использование в следующей проходят (отдельные транзакции)', async () => {
    const db = await prodLike();
    const ms = loadMigrations(
      folder(LEGACY_LAST_IDX + 1, [
        { sql: `CREATE TYPE "ci_kind" AS ENUM ('a');` },
        { sql: `ALTER TYPE "ci_kind" ADD VALUE 'b';` },
        { sql: `CREATE TABLE "ci_e" ("k" "ci_kind" DEFAULT 'b' NOT NULL);` },
      ]),
    );
    expect(await applyPending(client(db), ms)).toHaveLength(3);
  });

  it('миграция с потерей данных: без пометки и без разрешения не выполняется ничего', async () => {
    const db = await prodLike();
    const unmarked = loadMigrations(folder(LEGACY_LAST_IDX + 1, [{ sql: 'CREATE TABLE "ci_a" ("id" int);' }, { sql: 'DROP TABLE "ci_a";' }]));
    await expect(applyPending(client(db), unmarked)).rejects.toThrow(/DATA LOSS/);
    const marked = loadMigrations(folder(LEGACY_LAST_IDX + 1, [{ sql: 'CREATE TABLE "ci_a" ("id" int);' }, { sql: '-- DATA LOSS: таблица ci_a\nDROP TABLE "ci_a";' }]));
    await expect(applyPending(client(db), marked)).rejects.toThrow(/без разрешения: 0029_extra_1/);
    const t = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_name = 'ci_a'`);
    expect(t.rows[0].n).toBe(0);
    expect(await applyPending(client(db), marked, { allowDataLoss: true })).toHaveLength(2);
  });

  it('пропущенная миграция (when старее применённой) и изменённый после применения файл — ошибки, ничего не применяется', async () => {
    const db = await prodLike();
    await db.exec(`insert into drizzle.__drizzle_migrations (hash, created_at) values ('x', ${journal.entries[LEGACY_LAST_IDX].when + 5000})`);
    const ms = loadMigrations(folder(LEGACY_LAST_IDX + 1, [{ sql: 'CREATE TABLE "ci_skip" ("id" int);' }, { sql: 'CREATE TABLE "ci_after" ("id" int);', when: journal.entries[LEGACY_LAST_IDX].when + 5000 }]));
    const ins = await inspect(client(db), ms);
    expect(ins.errors.some((e) => e.includes('0028_extra_0: не применена'))).toBe(true);
    expect(ins.errors.some((e) => e.includes('0029_extra_1: хеш'))).toBe(true);
    await expect(applyPending(client(db), ms)).rejects.toThrow(/проверка журнала/);
  });

  it('в базе миграция, которой нет в репозитории — ошибка', async () => {
    const db = await prodLike();
    const ins = await inspect(client(db), loadMigrations(folder(LEGACY_LAST_IDX)));
    expect(ins.errors.some((e) => e.includes('нет в репозитории'))).toBe(true);
  });

  it('чистая база: все миграции применяются с нуля, схема как у стандартного мигратора', async () => {
    const a = new PGlite();
    await applyPending(client(a), loadMigrations(root), { allowDataLoss: true });
    const b = new PGlite();
    await migrate(drizzle(b), { migrationsFolder: root });
    expect(diffFingerprints(await schemaFingerprint(client(b)), await schemaFingerprint(client(a)))).toEqual({ missing: [], extra: [] });
  });
});
