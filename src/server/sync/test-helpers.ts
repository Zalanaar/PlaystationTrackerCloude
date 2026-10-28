// Хелперы тестов: PGlite в памяти (вне репозитория, без файлов) и фейковый psn-api на JSON-образцах.
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import * as schema from '@/db/schema';
import type { AnyDb } from '@/db/types';
import type { PsnApi } from '@/server/psn/client';
import played from '@/server/psn/__fixtures__/played-games.json';
import trophyTitles from '@/server/psn/__fixtures__/trophy-titles.json';
import specific from '@/server/psn/__fixtures__/specific-titles.json';
import trophyData from '@/server/psn/__fixtures__/trophies.json';

export type TestDb = { db: AnyDb; pg: PgliteDatabase<typeof schema>; reset: () => Promise<void>; close: () => Promise<void> };

export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const pg = drizzle(client, { schema });
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)) });
  return {
    db: pg as unknown as AnyDb,
    pg,
    reset: async () => {
      await client.exec(
        'TRUNCATE status_backups, game_status, game_trophy_sets, trophies, playtime_snapshots, trophy_sets, games, sync_runs, psn_auth RESTART IDENTITY CASCADE',
      );
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
    getProfileFromUserName: async () => {
      hit('profile');
      return { profile: { accountId: '1234567890', onlineId: 'Target' } };
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
