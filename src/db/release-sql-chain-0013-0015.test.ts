// QA 20.5: цепочка release-neon 0013 -> owner -> 0014 -> 0015 поверх прод-подобных данных (схема 0000–0012, 214 игр, снимки, трофеи) на PGlite.
// Проверяет то, чего не видят одиночные тесты: порядок применения подряд, повторный прогон всей цепочки, равенство схемы drizzle-миграциям,
// сохранность данных владельца, отказ при нарушенном порядке и работу второго пользователя после цепочки.
import { PGlite } from '@electric-sql/pglite';
import { freshPglite } from './test-utils/pglite';
import { folderUpTo } from './test-utils/release';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const rd = (f: string) => readFileSync(join(process.cwd(), 'docs', f), 'utf8');
const s13 = rd('release-neon-0013.sql');
const owner = rd('release-neon-0013-owner.sql').replaceAll('ВАШ_EMAIL@gmail.com', 'owner@example.com').replaceAll('ВАШ_ONLINE_ID', 'Target');
const s14 = rd('release-neon-0014.sql');
const s15 = rd('release-neon-0015.sql');


async function schemaDump(c: PGlite): Promise<string[]> {
  const cols = await c.query<{ s: string }>(
    `select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') as s from information_schema.columns where table_schema='public' order by 1`,
  );
  const cons = await c.query<{ s: string }>(`select conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) as s from pg_constraint where connamespace='public'::regnamespace order by 1`);
  const idx = await c.query<{ s: string }>(`select indexname||':'||indexdef as s from pg_indexes where schemaname='public' order by 1`);
  return [...cols.rows.map((r) => r.s), ...cons.rows.map((r) => r.s), ...idx.rows.map((r) => r.s)];
}

async function seedProd(c: PGlite): Promise<void> {
  await c.exec(`
    insert into games (title_id, name, category, last_seen_at, play_duration_seconds, last_played_at)
      select 'T'||g, 'Game '||g, 'ps4_game', now(), g*60, now() - (g||' hours')::interval from generate_series(1,214) g;
    insert into game_status (game_id, status, completed_at) select g, case when g%3=0 then 'completed' when g%3=1 then 'backlog' else 'dropped' end::game_status_value, case when g%3=0 then now() end from generate_series(1,214) g;
    insert into playtime_snapshots (game_id, snapshot_date, play_duration_seconds) select g, d::date, g*60 from generate_series(1,214) g, generate_series('2026-10-01'::date,'2026-10-30'::date,'1 day') d;
    insert into trophy_sets (np_communication_id, np_service_name, name, earned_bronze) select 'NPWR'||g, 'trophy', 'S'||g, 1 from generate_series(1,100) g;
    insert into trophies (trophy_set_id, trophy_id, type, earned, earned_at) select g, 0, 'bronze', true, now() from generate_series(1,100) g;
    insert into sync_runs (kind, snapshot_date) values ('daily', '2026-10-30');
    insert into psn_profile (id, online_id) values (1, 'me');
    insert into roadmap_settings (id, year, hours_per_week) values (1, 2026, 10);
    insert into recommend_reasons (game_id, signals_hash, text) values (1, 'h1', 'Фраза');
    insert into recommend_llm_usage (day, calls) values ('2026-10-30', 3);
    insert into planned_games (title, external_source, external_id) values ('P', 'rawg', '77');
  `);
}

const counts = async (c: PGlite) =>
  (await c.query<{ g: number; s: number; ps: number; t: number }>(
    `select (select count(*) from games)::int g, (select count(*) from game_status)::int s, (select count(*) from playtime_snapshots)::int ps, (select count(*) from trophies)::int t`,
  )).rows[0];

describe('цепочка release-neon 0013 -> owner -> 0014 -> 0015', () => {
  it('на прод-подобных данных: порядок, повторный прогон, схема = drizzle, данные целы, drizzle migrate no-op', async () => {
    const full = await freshPglite();
    await migrate(drizzle(full), { migrationsFolder: folderUpTo(16) });
    const c = await freshPglite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(13) });
    await seedProd(c);
    const before = await counts(c);
    expect(before).toEqual({ g: 214, s: 214, ps: 214 * 30, t: 100 });

    // каждый скрипт применяется по порядку и повторно сразу после себя (повторный запуск старого скрипта после более нового не поддерживается, см. отчёт)
    for (const sql of [s13, owner, s14, s15]) {
      await c.exec(sql);
      const once = await schemaDump(c);
      await c.exec(sql);
      expect(await schemaDump(c)).toEqual(once);
      expect(await counts(c)).toEqual(before);
    }
    expect(await schemaDump(c)).toEqual(await schemaDump(full));
    const u = await c.query(`select count(*)::int n from games where user_id <> 1`);
    expect(u.rows[0]).toEqual({ n: 0 });
    const o = await c.query(`select id, role, status, psn_online_id from allowed_users`);
    expect(o.rows).toEqual([{ id: 1, role: 'owner', status: 'active', psn_online_id: 'Target' }]);
    // драйзл не повторяет миграции
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(16) });
    expect((await c.query<{ n: number }>('select count(*)::int n from drizzle.__drizzle_migrations')).rows[0].n).toBe(16);
    expect((await counts(c))).toEqual(before);

    // второй пользователь с теми же title_id работает после цепочки, у владельца ничего не меняется
    await c.exec(`insert into allowed_users (email, role, status, psn_online_id, psn_access_status) values ('m@example.com','member','active','psnM','ok')`);
    await c.exec(`insert into games (user_id, title_id, name, category, last_seen_at) values (2, 'T1', 'Member game', 'ps4_game', now())`);
    expect((await counts(c)).g).toBe(215);
    expect((await c.query(`select name from games where user_id = 1 and title_id = 'T1'`)).rows).toEqual([{ name: 'Game 1' }]);
  });

  it('нарушенный порядок: 0015 без 0014 и 0014 без owner останавливаются до изменений', async () => {
    const c = await freshPglite();
    await migrate(drizzle(c), { migrationsFolder: folderUpTo(13) });
    await seedProd(c);
    await c.exec(s13);
    const dump = await schemaDump(c);
    await expect(c.exec(s14)).rejects.toThrow(); // owner ещё не создан
    expect(await schemaDump(c)).toEqual(dump);
    await expect(c.exec(s15)).rejects.toThrow(); // 0014 не применена
    expect(await schemaDump(c)).toEqual(dump);
    expect(await counts(c)).toEqual({ g: 214, s: 214, ps: 214 * 30, t: 100 });
  });
});
