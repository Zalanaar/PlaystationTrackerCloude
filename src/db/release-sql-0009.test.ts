// QA: docs/release-neon-0009.sql поверх 0000–0008 на PGlite: идемпотентность, схема = drizzle-миграция 0006, журнал, данные целы.
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
const releaseSql = readFileSync(join(process.cwd(), 'docs/release-neon-0009.sql'), 'utf8');


async function schemaDump(c: PGlite): Promise<string[]> {
  const cols = await c.query<{ s: string }>(
    `select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as s from information_schema.columns where table_schema='public' order by 1`,
  );
  const cons = await c.query<{ s: string }>(
    `select conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) as s from pg_constraint where connamespace='public'::regnamespace order by 1`,
  );
  return [...cols.rows.map((r) => r.s), ...cons.rows.map((r) => r.s)];
}

describe('docs/release-neon-0009.sql', () => {
  it('поверх 0000–0008 дважды: схема как у drizzle, журнал верный, данные целы', async () => {
    const full = await freshPglite();
    await migrate(drizzle(full), { migrationsFolder: folderUpTo(10) });

    const c = await freshPglite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(9) });
    await c.exec(`insert into games (title_id, name, category, last_seen_at) values ('CUSA1','Игра','ps4_game', now())`);
    await c.exec(releaseSql);
    const once = await schemaDump(c);
    await c.exec(releaseSql);
    expect(await schemaDump(c)).toEqual(once);
    expect(once).toEqual(await schemaDump(full));
    expect((await c.query('select name from games')).rows).toEqual([{ name: 'Игра' }]);

    const e = journalRaw.entries[9];
    const hash = createHash('sha256').update(readFileSync(join(root, `${e.tag}.sql`), 'utf8')).digest('hex');
    const j = await c.query<{ hash: string; created_at: string }>('select hash, created_at from drizzle.__drizzle_migrations where created_at = $1', [e.when]);
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].hash).toBe(hash);
  });

  it('после релизного SQL drizzle migrate ничего не применяет повторно; CHECK и PK и FK работают, каскад удаления', async () => {
    const c = await freshPglite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(9) });
    await c.exec(releaseSql);
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(15) });
    // с 0014 user_id = 1 ссылается на allowed_users: нужен owner
    await c.exec(`insert into allowed_users (email, role, status) values ('o@example.com', 'owner', 'active')`);
    const n = await c.query<{ n: number }>('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(n.rows[0].n).toBe(15);
    await c.exec(`insert into games (title_id, name, category, last_seen_at) values ('CUSA1','Игра','ps4_game', now())`);
    await c.exec(`insert into roadmap_excluded (game_id) values (1)`);
    await expect(c.exec(`insert into roadmap_excluded (game_id) values (1)`)).rejects.toThrow();
    await expect(c.exec(`insert into roadmap_excluded (game_id) values (99)`)).rejects.toThrow();
    await c.exec(`delete from games`);
    expect((await c.query('select * from roadmap_excluded')).rows).toHaveLength(0);
  });
});
