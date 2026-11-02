// Фаза 43 (контракт 43.3): поиск игры для Бэклога. Только PS5/PS4, кэш процесса (попадание не тратит лимит RAWG и не пишется в provider_usage).
import { searchCatalog, type CatalogCandidate, type CatalogDeps } from '@/server/catalog/rawg';
import { mskDateString } from '@/server/stats/period';

export const MANUAL_SEARCH_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 200;

export type SearchCache = Map<string, { at: number; value: CatalogCandidate[] }>;
const processCache: SearchCache = new Map();

export type ManualSearchDeps = Pick<CatalogDeps, 'apiKey' | 'fetch' | 'timeoutMs' | 'reserve'> & { now?: Date; cache?: SearchCache };

/** Ключ кэша: запрос без регистра и лишних пробелов. Ключ API в него не входит. */
export const searchCacheKey = (q: string): string => q.trim().toLowerCase().replace(/\s+/g, ' ');

/** Начало следующих суток МСК (UTC ISO): когда сбрасывается суточный лимит RAWG на профиль. */
export function rawgResetAt(now: Date): string {
  return new Date(Date.parse(`${mskDateString(now)}T00:00:00+03:00`) + 86_400_000).toISOString();
}

export async function searchPlayStation(q: string, deps: ManualSearchDeps): Promise<{ candidates: CatalogCandidate[]; cached: boolean }> {
  const now = deps.now ?? new Date();
  const cache = deps.cache ?? processCache;
  const key = searchCacheKey(q);
  const hit = cache.get(key);
  if (hit && now.getTime() >= hit.at && now.getTime() - hit.at < MANUAL_SEARCH_TTL_MS) return { candidates: hit.value, cached: true };
  const found = (await searchCatalog(q, { apiKey: deps.apiKey, fetch: deps.fetch, timeoutMs: deps.timeoutMs, reserve: deps.reserve, playstationOnly: true })).filter((c) => c.playstation);
  for (const [k, v] of cache) if (now.getTime() - v.at >= MANUAL_SEARCH_TTL_MS) cache.delete(k);
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: now.getTime(), value: found });
  return { candidates: found, cached: false };
}
