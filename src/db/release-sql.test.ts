// QA: docs/release-neon-0004-0005.sql поверх 0000–0003 на PGlite: идемпотентность, схема = drizzle-миграции, хеши и created_at журнала.
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'src/db/migrations');
const journal = JSON.parse(readFileSync(join(root, 'meta/_journal.json'), 'utf8')) as {
  entries: { idx: number; when: number; tag: string }[];
};
const releaseSql = readFileSync(join(process.cwd(), 'docs/release-neon-0004-0005.sql'), 'utf8');

function folderUpTo(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  mkdirSync(join(dir, 'meta'));
  const entries = journal.entries.slice(0, count);
  for (const e of entries) cpSync(join(root, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(root, 'meta/_journal.json'), 'utf8')), entries }));
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

describe('docs/release-neon-0004-0005.sql', () => {
  it('поверх 0000–0003 дважды: схема как у drizzle 0000–0005, журнал верный, данные целы', async () => {
    const full = new PGlite();
    await migrate(drizzle(full), { migrationsFolder: root });

    const c = new PGlite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(4) });
    await c.exec(`insert into games (np_communication_id, title) values ('x','Игра')`).catch(() => undefined);
    const before = await c.query('select count(*)::int as n from games');

    await c.exec(releaseSql);
    const afterOnce = await schemaDump(c);
    await c.exec(releaseSql);
    const afterTwice = await schemaDump(c);
    expect(afterTwice).toEqual(afterOnce);
    expect(afterOnce).toEqual(await schemaDump(full));

    const after = await c.query('select count(*)::int as n from games');
    expect(after.rows).toEqual(before.rows);

    const j = await c.query<{ hash: string; created_at: string }>('select hash, created_at from drizzle.__drizzle_migrations order by created_at');
    expect(j.rows).toHaveLength(6);
    for (const e of journal.entries.slice(4)) {
      const hash = createHash('sha256').update(readFileSync(join(root, `${e.tag}.sql`), 'utf8')).digest('hex');
      const row = j.rows.find((r) => Number(r.created_at) === e.when);
      expect(row?.hash, e.tag).toBe(hash);
    }
    // тот же формат хеша, что у самого drizzle
    const fj = await full.query<{ hash: string; created_at: string }>('select hash, created_at from drizzle.__drizzle_migrations order by created_at');
    expect(j.rows.map((r) => [r.hash, Number(r.created_at)])).toEqual(fj.rows.map((r) => [r.hash, Number(r.created_at)]));
  });

  it('после релизного SQL drizzle migrate не пытается применить 0004–0005 повторно', async () => {
    const c = new PGlite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(4) });
    await c.exec(releaseSql);
    await migrate(drizzle(c), { migrationsFolder: root });
    const n = await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(n.rows[0].n).toBe(6);
  });

  it('CHECK-ограничения: tint только #rrggbb, month только YYYY-MM', async () => {
    const c = new PGlite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(4) });
    await c.exec(releaseSql);
    await expect(c.exec(`update games set tint='red'`).then(async () => {
      await c.exec(`insert into games (np_communication_id,title) values ('a','b')`);
      await c.exec(`update games set tint='red'`);
    })).rejects.toThrow();
    await expect(c.exec(`insert into game_month_exclusions (game_id, month) values (1,'2025-13')`)).rejects.toThrow();
  });
});
