// Клиент PSN для синка: паузы между запросами, backoff на 429/5xx, пагинация, маппинг.
// Единственное место, откуда синк обращается к psn-api.
import * as psnLib from 'psn-api';
import { PsnError, classifyPsnError } from './errors';
import { mapEarnedTrophy, mapPlayedTitles, mapProfile, mapTrophyDef, mapTrophyTitle } from './mapping';
import type { PlayedGamesResult, PsnClient, PsnProfile, PsnTrophyDef, PsnTrophyEarned, PsnTrophySet, TrophySetRef } from './types';

/** Подмножество psn-api, которое нам нужно (подменяется в тестах JSON-образцами). */
export type PsnApi = Pick<
  typeof psnLib,
  | 'getProfileFromUserName'
  | 'getUserPlayedGames'
  | 'getUserTitles'
  | 'getUserTrophiesForSpecificTitle'
  | 'getUserTrophiesEarnedForTitle'
  | 'getTitleTrophies'
>;

export type ClientDeps = {
  getAccessToken: (force: boolean) => Promise<string>;
  onlineId: string;
  delayMs: number;
  api?: PsnApi;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** секреты для вырезания из сообщений ошибок */
  secrets?: ReadonlyArray<string | null | undefined>;
};

const BACKOFF_MS = [1000, 2000, 4000];
const PAGE = { played: 200, titles: 800, trophies: 800 };
const MAX_PAGES = 20;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function connectPsn(deps: ClientDeps): Promise<PsnClient> {
  const api = deps.api ?? psnLib;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const secrets = deps.secrets ?? [];

  let token = await deps.getAccessToken(false);
  let lastCallAt = 0;
  let refreshedOnce = false;

  /** Один вызов PSN: пауза, повторы на 429/5xx/сети, один refresh при 401. */
  async function call<T>(fn: (auth: { accessToken: string }) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = lastCallAt + deps.delayMs - now();
      if (wait > 0) await sleep(wait);
      lastCallAt = now();
      try {
        return await fn({ accessToken: token });
      } catch (e) {
        const err = classifyPsnError(e, [...secrets, token]);
        if (err.reason === 'auth_expired' && !refreshedOnce) {
          refreshedOnce = true;
          token = await deps.getAccessToken(true);
          attempt--;
          continue;
        }
        if (err.retryable && attempt < BACKOFF_MS.length) {
          await sleep(BACKOFF_MS[attempt]);
          continue;
        }
        throw err;
      }
    }
  }

  const profile = await call((auth) => api.getProfileFromUserName(auth, deps.onlineId));
  const accountId = profile?.profile?.accountId;
  if (typeof accountId !== 'string' || !accountId) {
    throw new PsnError('access_denied', 'Профиль PSN не найден: проверьте PSN_TARGET_ONLINE_ID и доступ технического аккаунта.');
  }

  /** Страницы до тех пор, пока собрано меньше totalItemCount (offset = число собранных элементов). */
  async function paginate<R>(load: (offset: number) => Promise<R>, items: (r: R) => unknown[], total: (r: R) => number | undefined): Promise<unknown[]> {
    const all: unknown[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await load(all.length);
      const batch = items(r);
      all.push(...batch);
      const t = total(r);
      if (batch.length === 0 || typeof t !== 'number' || all.length >= t) break;
    }
    return all;
  }

  let mappedProfile: PsnProfile | null = null;
  try {
    mappedProfile = mapProfile(profile);
  } catch {
    // профиль необязателен: ошибка маппинга не должна ронять синк
  }

  return {
    profile: mappedProfile,
    async getPlayedGames(): Promise<PlayedGamesResult> {
      const raw = await paginate(
        (offset) => call((auth) => api.getUserPlayedGames(auth, accountId, { limit: PAGE.played, offset })),
        (r) => (Array.isArray(r?.titles) ? r.titles : []),
        (r) => r.totalItemCount,
      );
      return mapPlayedTitles(raw);
    },

    async getTrophySets(): Promise<PsnTrophySet[]> {
      const raw = await paginate(
        (offset) => call((auth) => api.getUserTitles(auth, accountId, { limit: PAGE.titles, offset })),
        (r) => (Array.isArray(r?.trophyTitles) ? r.trophyTitles : []),
        (r) => r.totalItemCount,
      );
      return raw.map(mapTrophyTitle).filter((s): s is PsnTrophySet => s !== null);
    },

    async findTrophySets(titleIds: string[]): Promise<Map<string, PsnTrophySet[]>> {
      const out = new Map<string, PsnTrophySet[]>();
      if (titleIds.length === 0) return out;
      if (titleIds.length > 5) throw new Error('findTrophySets: не больше 5 titleId за вызов');
      const r = await call((auth) => api.getUserTrophiesForSpecificTitle(auth, accountId, { npTitleIds: titleIds.join(',') }));
      for (const t of Array.isArray(r?.titles) ? r.titles : []) {
        if (typeof t?.npTitleId !== 'string') continue;
        const sets = (Array.isArray(t.trophyTitles) ? t.trophyTitles : []).map(mapTrophyTitle).filter((s): s is PsnTrophySet => s !== null);
        if (sets.length) out.set(t.npTitleId, sets);
      }
      return out;
    },

    async getEarnedTrophies(set: TrophySetRef): Promise<PsnTrophyEarned[]> {
      const raw = await paginate(
        (offset) =>
          call((auth) =>
            api.getUserTrophiesEarnedForTitle(auth, accountId, set.npCommunicationId, 'all', {
              npServiceName: set.npServiceName,
              limit: PAGE.trophies,
              offset,
            }),
          ),
        (r) => (Array.isArray(r?.trophies) ? r.trophies : []),
        (r) => r.totalItemCount,
      );
      return raw.map(mapEarnedTrophy).filter((t): t is PsnTrophyEarned => t !== null);
    },

    async getTrophyDefinitions(set: TrophySetRef): Promise<PsnTrophyDef[]> {
      const raw = await paginate(
        (offset) =>
          call((auth) =>
            api.getTitleTrophies(auth, set.npCommunicationId, 'all', {
              npServiceName: set.npServiceName,
              limit: PAGE.trophies,
              offset,
            }),
          ),
        (r) => (Array.isArray(r?.trophies) ? r.trophies : []),
        (r) => r.totalItemCount,
      );
      return raw.map(mapTrophyDef).filter((t): t is PsnTrophyDef => t !== null);
    },
  };
}
