// QA: docs/release-neon-0010.sql поверх 0000–0009 на PGlite: идемпотентность, схема = drizzle-миграция 0010, журнал, данные целы.
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
const releaseSql = readFileSync(join(process.cwd(), 'docs/release-neon-0010.sql'), 'utf8');

function folderUpTo(count: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig10-'));
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

describe('docs/release-neon-0010.sql', () => {
  it('поверх 0000–0009 дважды: схема как у drizzle, журнал верный, данные целы', async () => {
    // Эталон = схема после 0010 (новые миграции после неё сверяются в своих тестах).
    const full = new PGlite();
    await migrate(drizzle(full), { migrationsFolder: folderUpTo(11) });

    const c = new PGlite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(10) });
    await c.exec(`insert into games (title_id, name, category, last_seen_at) values ('CUSA1','Игра','ps4_game', now())`);
    await c.exec(releaseSql);
    const once = await schemaDump(c);
    await c.exec(releaseSql);
    expect(await schemaDump(c)).toEqual(once);
    expect(once).toEqual(await schemaDump(full));
    expect((await c.query('select name from games')).rows).toEqual([{ name: 'Игра' }]);

    const e = journalRaw.entries[10];
    const hash = createHash('sha256').update(readFileSync(join(root, `${e.tag}.sql`), 'utf8')).digest('hex');
    const j = await c.query<{ hash: string; created_at: string }>('select hash, created_at from drizzle.__drizzle_migrations where created_at = $1', [e.when]);
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].hash).toBe(hash);
  });

  it('после релизного SQL drizzle migrate ничего не применяет повторно; CHECK и PK и FK работают, каскад удаления', async () => {
    const c = new PGlite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(10) });
    await c.exec(releaseSql);
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(15) }); // применит только последующие (0011+)
    // с 0014 user_id = 1 ссылается на allowed_users: нужен owner
    await c.exec(`insert into allowed_users (email, role, status) values ('o@example.com', 'owner', 'active')`);
    const n = await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(n.rows[0].n).toBe(15);
    await c.exec(`insert into games (title_id, name, category, last_seen_at) values ('CUSA1','Игра','ps4_game', now())`);
    await c.exec(`insert into recommend_dislikes (game_id) values (1)`);
    await expect(c.exec(`insert into recommend_dislikes (game_id) values (1)`)).rejects.toThrow();
    await expect(c.exec(`insert into recommend_dislikes (game_id) values (99)`)).rejects.toThrow();
    await c.exec(`insert into recommend_reasons (game_id, signals_hash, text) values (1, 'h', 'Фраза')`);
    await expect(c.exec(`insert into recommend_reasons (game_id, signals_hash, text) values (1, 'h', 'Дубль')`)).rejects.toThrow();
    await expect(c.exec(`insert into recommend_reasons (game_id, signals_hash, text) values (1, 'h2', '')`)).rejects.toThrow();
    await expect(c.exec(`insert into recommend_reasons (game_id, signals_hash, text) values (1, 'h3', '${'x'.repeat(401)}')`)).rejects.toThrow();
    await c.exec(`insert into recommend_llm_usage (day, calls) values ('2026-10-29', 3)`);
    await expect(c.exec(`insert into recommend_llm_usage (day, calls) values ('2026-10-30', -1)`)).rejects.toThrow();
    await c.exec(`delete from games`);
    expect((await c.query('select * from recommend_dislikes')).rows).toHaveLength(0);
    expect((await c.query('select * from recommend_reasons')).rows).toHaveLength(0);
  });
});
