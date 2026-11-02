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

/** Фаза 44 (контракт 44.3): поиск по всем платформам RAWG, отдельный кэш (ключ не пересекается с PS-поиском). */
const anyProcessCache: SearchCache = new Map();
export async function searchAnyPlatform(q: string, deps: ManualSearchDeps): Promise<{ candidates: CatalogCandidate[]; cached: boolean }> {
  const now = deps.now ?? new Date();
  const cache = deps.cache ?? anyProcessCache;
  const key = searchCacheKey(q);
  const hit = cache.get(key);
  if (hit && now.getTime() >= hit.at && now.getTime() - hit.at < MANUAL_SEARCH_TTL_MS) return { candidates: hit.value, cached: true };
  const found = await searchCatalog(q, { apiKey: deps.apiKey, fetch: deps.fetch, timeoutMs: deps.timeoutMs, reserve: deps.reserve });
  for (const [k, v] of cache) if (now.getTime() - v.at >= MANUAL_SEARCH_TTL_MS) cache.delete(k);
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: now.getTime(), value: found });
  return { candidates: found, cached: false };
}

// --- Фаза 43.1 (контракт 43.1.3): подсказки при вводе

export const SUGGEST_PAGE_SIZE = 8;
export const SUGGEST_MIN_PREFIX = 3;

type SuggestEntry = { at: number; value: CatalogCandidate[]; complete: boolean };
export type SuggestCache = Map<string, SuggestEntry>;
const suggestProcessCache: SuggestCache = new Map();

export type SuggestDeps = ManualSearchDeps & { suggestCache?: SuggestCache };

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Локальный фильтр короткой выдачи под более длинный запрос: каждый токен запроса есть в названии. */
export function filterByQuery(cands: readonly CatalogCandidate[], q: string): CatalogCandidate[] {
  const tokens = norm(q).split(' ').filter(Boolean);
  return cands.filter((c) => {
    const t = norm(c.title);
    return tokens.every((x) => t.includes(x));
  });
}

/**
 * Подсказки: точный или префиксный кэш (без RAWG и без лимита), иначе один запрос на 8 результатов.
 * Префиксная выдача годится, только если она была полной (RAWG вернул меньше 8: обрезки нет).
 */
export async function suggestPlayStation(q: string, deps: SuggestDeps): Promise<{ candidates: CatalogCandidate[]; cached: boolean }> {
  const now = (deps.now ?? new Date()).getTime();
  const cache = deps.suggestCache ?? suggestProcessCache;
  const key = searchCacheKey(q);
  const fresh = (e: SuggestEntry) => now >= e.at && now - e.at < MANUAL_SEARCH_TTL_MS;
  const exact = cache.get(key);
  if (exact && fresh(exact)) return { candidates: exact.value, cached: true };
  let best: { k: string; e: SuggestEntry } | null = null;
  for (const [k, e] of cache) {
    if (k.length >= SUGGEST_MIN_PREFIX && k.length < key.length && key.startsWith(k) && e.complete && fresh(e) && (!best || k.length > best.k.length)) best = { k, e };
  }
  if (best) return { candidates: filterByQuery(best.e.value, q).slice(0, SUGGEST_PAGE_SIZE), cached: true };
  const all = await searchCatalog(q, { apiKey: deps.apiKey, fetch: deps.fetch, timeoutMs: deps.timeoutMs, reserve: deps.reserve, playstationOnly: true, pageSize: SUGGEST_PAGE_SIZE });
  const found = all.filter((c) => c.playstation).slice(0, SUGGEST_PAGE_SIZE);
  for (const [k, e] of cache) if (now - e.at >= MANUAL_SEARCH_TTL_MS) cache.delete(k);
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  // «Полная» = RAWG вернул меньше page_size (до нашего фильтра): обрезки не было
  cache.set(key, { at: now, value: found, complete: all.length < SUGGEST_PAGE_SIZE });
  return { candidates: found, cached: false };
}
