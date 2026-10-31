// Хелперы тестов: PGlite в памяти (вне репозитория, без файлов) и фейковый psn-api на JSON-образцах.
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '@/db/schema';
import { asUserId } from '@/server/auth/user-id';
import type { AnyDb } from '@/db/types';
import type { PsnApi } from '@/server/psn/client';
import played from '@/server/psn/__fixtures__/played-games.json';
import trophyTitles from '@/server/psn/__fixtures__/trophy-titles.json';
import specific from '@/server/psn/__fixtures__/specific-titles.json';
import trophyData from '@/server/psn/__fixtures__/trophies.json';

/** Владелец из createTestDb (id = 1). */
export const TEST_USER = asUserId(1);
export const TEST_USER_2 = asUserId(2);

export type TestDb = { db: AnyDb; pg: PgliteDatabase<typeof schema>; reset: () => Promise<void>; close: () => Promise<void> };

/** Папка миграций, обрезанная до первых count записей журнала (проверка состояния прода между миграциями). */
function migrationsFolder(count?: number): string {
  const root = fileURLToPath(new URL('../../db/migrations', import.meta.url));
  if (count === undefined) return root;
  const journal = JSON.parse(readFileSync(join(root, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  const dir = mkdtempSync(join(tmpdir(), 'testdb-'));
  mkdirSync(join(dir, 'meta'));
  const entries = journal.entries.slice(0, count);
  for (const e of entries) cpSync(join(root, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
  return dir;
}

/** opts.migrations: сколько миграций применить (по умолчанию все); 15 = схема ровно после 0014. */
export async function createTestDb(opts: { migrations?: number } = {}): Promise<TestDb> {
  const client = new PGlite();
  const pg = drizzle(client, { schema });
  await migrate(pg, { migrationsFolder: migrationsFolder(opts.migrations) });
  // срезы журнала (до 0016) всё равно получают колонки тура: схема drizzle в коде их уже выбирает, а 0016 к срезу 0015 ортогональна
  if (opts.migrations !== undefined) {
    await client.exec('ALTER TABLE allowed_users ADD COLUMN IF NOT EXISTS tour_version integer, ADD COLUMN IF NOT EXISTS tour_completed_at timestamp with time zone');
    // то же для колонок дублей (0018): схема drizzle в коде их уже выбирает
    await client.exec('ALTER TABLE games ADD COLUMN IF NOT EXISTS duplicate_of_game_id integer, ADD COLUMN IF NOT EXISTS not_duplicate boolean NOT NULL DEFAULT false');
  }
  // с 0014 у всех данных user_id = 1 (owner): строка должна существовать, reset() её не трогает
  await client.exec(`insert into allowed_users (email, role, status) values ('owner@example.com', 'owner', 'active')`);
  return {
    db: pg as unknown as AnyDb,
    pg,
    reset: async () => {
      await client.exec(
        'TRUNCATE recommend_external_dislikes, recommend_discover_cache, recommend_llm_usage, recommend_llm_state, recommend_reasons, recommend_dislikes, roadmap_excluded, roadmap_order, roadmap_settings, planned_games, notify_log, game_month_exclusions, status_backups, game_status, game_trophy_sets, trophies, playtime_snapshots, trophy_sets, games, sync_runs, psn_auth, psn_profile RESTART IDENTITY CASCADE',
      );
      // provider_usage есть только с 0017 (срезы журнала её не имеют)
      await client.exec(`DO $$ BEGIN IF to_regclass('public.provider_usage') IS NOT NULL THEN TRUNCATE provider_usage; END IF; END $$`);
    },
    close: () => client.close(),
  };
}

type Json = Record<string, unknown>;
export const fixtures = { played: played as unknown as { titles: Json[] }, trophyTitles: trophyTitles as unknown as { trophyTitles: Json[] } };

export type FakeState = {
  /** изменяемая копия списка игр */
  titles: Json[];
  trophyTitles: Json[];
  trophies: Record<string, { defs: Json[]; earned: Json[] }>;
  /** сколько тайтлов отдавать за страницу (проверка пагинации) */
  pageSize: number;
  calls: Record<string, number>;
  /** если задано, вызов с этим именем бросает ошибку (один раз или всегда) */
  failOn: Map<string, { error: Error; times: number }>;
};

export function freshState(): FakeState {
  return {
    titles: structuredClone(played.titles) as unknown as Json[],
    trophyTitles: structuredClone(trophyTitles.trophyTitles) as unknown as Json[],
    trophies: structuredClone(trophyData) as unknown as FakeState['trophies'],
    pageSize: 3,
    calls: {},
    failOn: new Map(),
  };
}

/** Фейковый psn-api: отвечает JSON-образцами в формате реальных ответов. */
export function fakeApi(state: FakeState): PsnApi {
  const hit = (name: string) => {
    state.calls[name] = (state.calls[name] ?? 0) + 1;
    const f = state.failOn.get(name);
    if (f && f.times > 0) {
      f.times -= 1;
      throw f.error;
    }
  };
  const page = (items: Json[], offset: number, limit: number) => {
    const size = Math.min(limit, state.pageSize);
    return items.slice(offset, offset + size);
  };
  const api = {
    getProfileFromAccountId: async () => {
      hit('profileByAccount');
      return { onlineId: 'Target', avatars: [] };
    },
    getProfileFromUserName: async () => {
      hit('profile');
      return {
        profile: {
          accountId: '1234567890',
          onlineId: 'Target',
          avatarUrls: [
            { size: 's', avatarUrl: 'https://img.example/av-s.png' },
            { size: 'xl', avatarUrl: 'https://img.example/av-xl.png' },
            { size: 'm', avatarUrl: 'https://img.example/av-m.png' },
          ],
          trophySummary: { level: 312, progress: 47, tier: 7, earnedTrophies: { platinum: 38, gold: 410, silver: 1100, bronze: 2800 } },
        },
      };
    },
    getUserPlayedGames: async (_a: unknown, _id: string, o: { limit?: number; offset?: number } = {}) => {
      hit('played');
      const offset = o.offset ?? 0;
      const titles = page(state.titles, offset, o.limit ?? 50);
      return { titles, totalItemCount: state.titles.length, nextOffset: offset + titles.length, previousOffset: 0 };
    },
    getUserTitles: async (_a: unknown, _id: string, o: { limit?: number; offset?: number } = {}) => {
      hit('titles');
      const offset = o.offset ?? 0;
      const trophyTitlesPage = page(state.trophyTitles, offset, o.limit ?? 50);
      return { trophyTitles: trophyTitlesPage, totalItemCount: state.trophyTitles.length, nextOffset: offset + trophyTitlesPage.length };
    },
    getUserTrophiesForSpecificTitle: async (_a: unknown, _id: string, o: { npTitleIds: string }) => {
      hit('specific');
      const ids = o.npTitleIds.split(',');
      if (ids.length > 5) throw new Error('Bad Request');
      return {
        titles: ids.map((id) => ({
          npTitleId: id,
          trophyTitles: ((specific as Record<string, string[]>)[id] ?? [])
            .map((np) => state.trophyTitles.find((t) => t.npCommunicationId === np))
            .filter(Boolean),
        })),
      };
    },
    getUserTrophiesEarnedForTitle: async (_a: unknown, _id: string, np: string, _g: string, o: { limit?: number; offset?: number } = {}) => {
      hit('earned');
      const all = state.trophies[np]?.earned ?? [];
      const trophies = page(all, o.offset ?? 0, o.limit ?? 50);
      return { trophies, totalItemCount: all.length, trophySetVersion: '01.00', hasTrophyGroups: false, lastUpdatedDateTime: '' };
    },
    getTitleTrophies: async (_a: unknown, np: string, _g: string, o: { limit?: number; offset?: number } = {}) => {
      hit('defs');
      const all = state.trophies[np]?.defs ?? [];
      const trophies = page(all, o.offset ?? 0, o.limit ?? 50);
      return { trophies, totalItemCount: all.length, trophySetVersion: '01.00', hasTrophyGroups: false };
    },
  };
  return api as unknown as PsnApi;
}
