// docs/release-neon-0025.sql (профили PSN, Фаза 41) поверх 0000–0024 на PGlite: идемпотентность, схема = drizzle-миграция 0025,
// журнал, данные целы, check-запрос, ограничения (роль, google_sub, вложенность, PSN-уникальность, архив, каскады), rollback.
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
const doc = (n: string) => readFileSync(join(process.cwd(), 'docs', n), 'utf8');
const releaseSql = doc('release-neon-0025.sql');
const checkSql = doc('release-neon-0025-check.sql');
const rollbackSql = doc('release-neon-0025-rollback.sql');
const E = journalRaw.entries.findIndex((e) => e.tag === '0025_psn_profiles');


async function schemaDump(c: PGlite): Promise<string[]> {
  const cols = await c.query<{ s: string }>(
    `select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as s from information_schema.columns where table_schema='public' order by 1`,
  );
  const cons = await c.query<{ s: string }>(`select conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) as s from pg_constraint where connamespace='public'::regnamespace order by 1`);
  const idx = await c.query<{ s: string }>(`select indexname||':'||indexdef as s from pg_indexes where schemaname='public' order by 1`);
  return [...cols.rows.map((r) => r.s), ...cons.rows.map((r) => r.s), ...idx.rows.map((r) => r.s)];
}

/** Прод-подобное состояние: 3 пользователя (owner id 1), игры у каждого. */
async function after0024(): Promise<PGlite> {
  const c = await freshPglite();
  await migrate(drizzle(c), { migrationsFolder: folderUpTo(E) });
  await c.exec(`
    insert into allowed_users (email, role, status, psn_online_id, psn_account_id) values ('o@example.com', 'owner', 'active', 'Owner', 'a1');
    insert into allowed_users (email, role, status, psn_online_id, psn_account_id) values ('m@example.com', 'member', 'active', 'Mem', 'a2');
    insert into allowed_users (email, role, status) values ('n@example.com', 'member', 'invited');
    insert into games (user_id, title_id, name, category, last_seen_at) values (1, 'X', 'X', 'ps4_game', now());
    insert into games (user_id, title_id, name, category, last_seen_at) values (2, 'X', 'X', 'ps4_game', now());
    insert into games (user_id, title_id, name, category, last_seen_at) values (2, 'Y', 'Y', 'ps4_game', now());
    insert into game_status (game_id, user_id, status) values (1, 1, 'playing');
  `);
  return c;
}

const n = async (c: PGlite, sql: string): Promise<number> => Number((await c.query<{ n: number }>(`select count(*)::int as n from ${sql}`)).rows[0].n);
const ins = (c: PGlite, cols: string) => c.exec(`insert into allowed_users (email, role, status, primary_user_id, psn_online_id, psn_account_id, google_sub, archived_at) values (${cols})`);

describe('docs/release-neon-0025.sql', () => {
  it('0025 идёт сразу после 0024', () => {
    expect(E).toBeGreaterThan(0);
    expect(journalRaw.entries[E - 1].tag).toBe('0024_owned_marks');
  });

  it('поверх 0000–0024 дважды: схема как у drizzle, журнал верный, данные целы, check «до/после»', async () => {
    const full = await freshPglite();
    await migrate(drizzle(full), { migrationsFolder: folderUpTo(E + 1) });
    const c = await after0024();
    const checkData = async () => (await c.query<{ t: string; n: number }>(checkSql)).rows;
    const before = await checkData();
    await c.exec(releaseSql);
    const once = await schemaDump(c);
    await c.exec(releaseSql);
    expect(await schemaDump(c)).toEqual(once);
    expect(once).toEqual(await schemaDump(full));

    const after = await checkData();
    const data = (rows: typeof after) => rows.filter((r) => !r.t.startsWith('zz_'));
    expect(data(after)).toEqual(data(before));
    expect(Number(before.find((r) => r.t === 'users_total')?.n)).toBe(3);
    expect(data(after).filter((r) => r.t.startsWith('bad_')).every((r) => Number(r.n) === 0)).toBe(true);
    expect(Number(before.find((r) => r.t === 'zz_primary_user_id_column')?.n)).toBe(0);
    expect(Number(after.find((r) => r.t === 'zz_primary_user_id_column')?.n)).toBe(1);
    expect(Number(after.find((r) => r.t === 'zz_profile_indexes')?.n)).toBe(4);
    expect(await n(c, 'allowed_users where primary_user_id is not null or archived_at is not null')).toBe(0);
    expect(await n(c, 'games')).toBe(3);

    const e = journalRaw.entries[E];
    const hash = createHash('sha256').update(readFileSync(join(root, `${e.tag}.sql`), 'utf8')).digest('hex');
    const j = await c.query<{ hash: string }>('select hash from drizzle.__drizzle_migrations where created_at = $1', [e.when]);
    expect(j.rows).toHaveLength(1);
    expect(j.rows[0].hash).toBe(hash);
    const res = (await c.query<Record<string, boolean>>(releaseSql.slice(releaseSql.lastIndexOf('SELECT\n')))).rows[0];
    expect(Object.values(res).every(Boolean)).toBe(true);
  });

  it('ограничения: почта среди основных, роль/google_sub дополнительного, вложенность, PSN-уникальность, архив', async () => {
    const c = await after0024();
    await c.exec(releaseSql);
    // дополнительный профиль с копией почты входа можно
    await ins(c, `'m@example.com', 'member', 'active', 2, 'Mem2', 'a3', null, null`);
    // два основных с одной почтой нельзя (и регистр не важен только для приложения, здесь точное совпадение)
    await expect(ins(c, `'m@example.com', 'member', 'invited', null, null, null, null, null`)).rejects.toThrow();
    // owner как дополнительный и google_sub у дополнительного нельзя; дополнительный сам на себя
    await expect(ins(c, `'o@example.com', 'owner', 'active', 1, null, null, null, null`)).rejects.toThrow();
    await expect(ins(c, `'m@example.com', 'member', 'active', 2, 'Mem3', 'a4', 'sub-x', null`)).rejects.toThrow();
    await expect(c.exec(`update allowed_users set primary_user_id = id where id = 3`)).rejects.toThrow();
    // дубль аккаунта PSN и ника (без учёта регистра), в том числе в чужом входе
    await expect(ins(c, `'o@example.com', 'member', 'active', 1, 'Other', 'a3', null, null`)).rejects.toThrow();
    await expect(ins(c, `'o@example.com', 'member', 'active', 1, 'MEM2', 'a9', null, null`)).rejects.toThrow();
    await expect(ins(c, `'o@example.com', 'member', 'active', 1, 'mem', 'a9', null, null`)).rejects.toThrow();
    // archived_at согласован со status; архивный только дополнительный
    await expect(ins(c, `'m@example.com', 'member', 'archived', 2, null, null, null, null`)).rejects.toThrow();
    await expect(ins(c, `'m@example.com', 'member', 'active', 2, null, null, null, now()`)).rejects.toThrow();
    await expect(c.exec(`update allowed_users set status = 'archived', archived_at = now() where id = 3`)).rejects.toThrow(); // основной
    // архивный профиль не блокирует тот же аккаунт и ник
    await c.exec(`update allowed_users set status = 'archived', archived_at = now() where psn_account_id = 'a3'`);
    await ins(c, `'o@example.com', 'member', 'active', 1, 'MEM2', 'a3', null, null`);
    await ins(c, `'o@example.com', 'member', 'archived', 1, 'MEM2', 'a3', null, now()`); // два архивных с тем же аккаунтом
    // статус вне списка по-прежнему нельзя
    await expect(c.exec(`update allowed_users set status = 'zzz' where id = 3`)).rejects.toThrow();
  });

  it('вложенность ловит проверка, дубли PSN в данных останавливают скрипт без изменений', async () => {
    const c = await after0024();
    await c.exec(releaseSql);
    await ins(c, `'m@example.com', 'member', 'active', 2, 'Mem2', 'a3', null, null`); // id 4
    await ins(c, `'m@example.com', 'member', 'active', 4, 'Mem3', 'a4', null, null`); // вложенный: БД пропускает
    const nested = await n(c, 'allowed_users p join allowed_users cc on cc.id = p.primary_user_id where cc.primary_user_id is not null');
    expect(nested).toBe(1); // его видно по запросу из check.sql

    const d = await freshPglite();
    await migrate(drizzle(d), { migrationsFolder: folderUpTo(E) });
    await d.exec(`
      insert into allowed_users (email, role, status, psn_online_id) values ('o@example.com', 'owner', 'active', 'Same');
      insert into allowed_users (email, role, status, psn_online_id) values ('m@example.com', 'member', 'active', 'same');`);
    await expect(d.exec(releaseSql)).rejects.toThrow(/0025/);
    expect(await n(d, `information_schema.columns where table_name = 'allowed_users' and column_name = 'primary_user_id'`)).toBe(0);
    const dd = await freshPglite();
    await migrate(drizzle(dd), { migrationsFolder: folderUpTo(E) });
    await dd.exec(`
      insert into allowed_users (email, role, status, psn_account_id) values ('o@example.com', 'owner', 'active', 'dup');
      insert into allowed_users (email, role, status, psn_account_id) values ('m@example.com', 'member', 'active', 'dup');`);
    await expect(dd.exec(releaseSql)).rejects.toThrow(/psn_account_id/);
  });

  it('каскад: удаление входа сносит его профили и данные, соседний вход цел', async () => {
    const c = await after0024();
    await c.exec(releaseSql);
    await ins(c, `'m@example.com', 'member', 'active', 2, 'Mem2', 'a3', null, null`); // id 4
    await c.exec(`insert into games (user_id, title_id, name, category, last_seen_at) values (4, 'Z', 'Z', 'ps4_game', now())`);
    await c.exec(`delete from allowed_users where id = 4`);
    expect(await n(c, 'games where user_id = 4')).toBe(0);
    expect(await n(c, 'games where user_id = 2')).toBe(2);
    await ins(c, `'m@example.com', 'member', 'active', 2, 'Mem2', 'a3', null, null`); // id 5
    await c.exec(`insert into games (user_id, title_id, name, category, last_seen_at) values (5, 'Z', 'Z', 'ps4_game', now())`);
    await c.exec(`delete from allowed_users where id = 2`); // вход целиком: основной уходит, дополнительный по FK primary_user_id
    expect(await n(c, 'allowed_users where id in (2, 5)')).toBe(0);
    expect(await n(c, 'games where user_id = 5')).toBe(0);
    expect(await n(c, 'games where user_id = 1')).toBe(1);
  });

  it('rollback отказывает при дополнительных профилях, иначе возвращает схему 0024 и убирает запись журнала', async () => {
    const c = await after0024();
    await c.exec(releaseSql);
    await ins(c, `'m@example.com', 'member', 'active', 2, 'Mem2', 'a3', null, null`);
    await expect(c.exec(rollbackSql)).rejects.toThrow(/0025 rollback/);
    expect(await n(c, `information_schema.columns where table_name = 'allowed_users' and column_name = 'primary_user_id'`)).toBe(1);
    await c.exec(`delete from allowed_users where primary_user_id is not null`);
    const old = await after0024();
    const oldDump = await schemaDump(old);
    await c.exec(rollbackSql);
    await c.exec(rollbackSql); // идемпотентно
    expect(await schemaDump(c)).toEqual(oldDump);
    expect(await n(c, 'allowed_users')).toBe(3);
    expect(await n(c, `drizzle.__drizzle_migrations where created_at = ${journalRaw.entries[E].when}`)).toBe(0);
  });

  it('после релизного SQL drizzle migrate ничего не применяет повторно', async () => {
    const c = await after0024();
    await c.exec(releaseSql);
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(E + 1) });
    expect(await n(c, 'drizzle.__drizzle_migrations')).toBe(E + 1);
  });

  it('без 0024 скрипт останавливается с понятной ошибкой', async () => {
    await expect((await freshPglite()).exec(releaseSql)).rejects.toThrow(/0025/);
  });
});
