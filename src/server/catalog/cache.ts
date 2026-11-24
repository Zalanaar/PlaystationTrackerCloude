// Общий кэш ответов RAWG в БД (релизы, поиск, карточка игры). Без user_id: страница одна на всех.
// TTL 12 ч для списков/поиска, 24 ч для карточки игры. Просроченную запись не удаляем: при 429 отдаём её как stale.
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { mskDateString } from '@/server/stats/period';
import {
  CatalogError,
  getCatalogGame,
  getUpcoming,
  searchCatalog,
  type CatalogCandidate,
  type CatalogDeps,
  type UpcomingPage,
} from '@/server/catalog/rawg';
import { upcomingWindowEnd, UPCOMING_WINDOW_DAYS } from '@/shared/upcoming-catalog';

export const CATALOG_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
export const CATALOG_GAME_TTL_MS = 24 * 60 * 60 * 1000;

export type CatalogCacheKind = 'upcoming' | 'search' | 'game' | 'meta';

export type CatalogCacheStore = {
  get(key: string): Promise<{ payload: unknown; fetchedAt: number } | null>;
  set(key: string, kind: CatalogCacheKind, payload: unknown, fetchedAt: number): Promise<void>;
};

export type CachedResult<T> = { value: T; fetchedAt: number; stale: boolean; rawgCalls: number };

export function isFresh(fetchedAt: number, now: number, ttlMs: number): boolean {
  return now >= fetchedAt && now - fetchedAt < ttlMs;
}

export function upcomingCacheKey(from: string, to: string, page: number): string {
  return `upcoming:${from}|${to}|${page}`;
}

export function searchCacheKey(query: string, playstationOnly: boolean, pageSize: number): string {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
  return `search:${playstationOnly ? 'ps' : 'any'}:${pageSize}:${q}`;
}

export function gameCacheKey(id: string): string {
  return `game:${id.trim()}`;
}

export function plannedRefreshJobKey(day: string): string {
  return `meta:planned-dates:${day}`;
}

export function memoryCatalogCache(): CatalogCacheStore {
  const m = new Map<string, { payload: unknown; fetchedAt: number }>();
  return {
    async get(key) {
      return m.get(key) ?? null;
    },
    async set(key, _kind, payload, fetchedAt) {
      m.set(key, { payload, fetchedAt });
    },
  };
}

export function dbCatalogCache(db: AnyDb): CatalogCacheStore {
  const t = schema.catalogCache;
  return {
    async get(key) {
      const [row] = await db.select({ payload: t.payload, fetchedAt: t.fetchedAt }).from(t).where(eq(t.cacheKey, key)).limit(1);
      if (!row) return null;
      return { payload: row.payload, fetchedAt: row.fetchedAt.getTime() };
    },
    async set(key, kind, payload, fetchedAt) {
      const at = new Date(fetchedAt);
      await db
        .insert(t)
        .values({ cacheKey: key, kind, payload, fetchedAt: at })
        .onConflictDoUpdate({ target: t.cacheKey, set: { kind, payload, fetchedAt: at } });
    },
  };
}

type LoadDeps = CatalogDeps & { store: CatalogCacheStore; now?: Date };

async function read<T>(store: CatalogCacheStore, key: string, parse: (p: unknown) => T | null): Promise<{ value: T; fetchedAt: number } | null> {
  const row = await store.get(key);
  if (!row) return null;
  const value = parse(row.payload);
  return value === null ? null : { value, fetchedAt: row.fetchedAt };
}

function parseUpcoming(p: unknown): UpcomingPage | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as UpcomingPage;
  if (!Array.isArray(o.candidates) || typeof o.page !== 'number' || typeof o.hasMore !== 'boolean') return null;
  return o;
}

function parseCandidates(p: unknown): CatalogCandidate[] | null {
  return Array.isArray(p) ? (p as CatalogCandidate[]) : null;
}

function parseGame(p: unknown): CatalogCandidate | null | undefined {
  if (p === null) return null;
  if (!p || typeof p !== 'object' || typeof (p as CatalogCandidate).externalId !== 'string') return undefined;
  return p as CatalogCandidate;
}

export async function cachedUpcoming(page: number, deps: LoadDeps): Promise<CachedResult<UpcomingPage>> {
  const now = deps.now ?? new Date();
  const from = mskDateString(now);
  const to = upcomingWindowEnd(from, UPCOMING_WINDOW_DAYS);
  const key = upcomingCacheKey(from, to, page);
  const hit = await read(deps.store, key, parseUpcoming);
  if (hit && isFresh(hit.fetchedAt, now.getTime(), CATALOG_CACHE_TTL_MS)) {
    return { value: hit.value, fetchedAt: hit.fetchedAt, stale: false, rawgCalls: 0 };
  }
  try {
    const value = await getUpcoming(page, { ...deps, now, cache: new Map() });
    const at = now.getTime();
    await deps.store.set(key, 'upcoming', value, at);
    return { value, fetchedAt: at, stale: false, rawgCalls: 1 };
  } catch (e) {
    if (hit) return { value: hit.value, fetchedAt: hit.fetchedAt, stale: true, rawgCalls: 1 };
    throw e;
  }
}

export async function cachedSearch(
  query: string,
  deps: LoadDeps & { playstationOnly?: boolean; pageSize?: number },
): Promise<CachedResult<CatalogCandidate[]>> {
  const now = deps.now ?? new Date();
  const pageSize = deps.pageSize ?? 10;
  const key = searchCacheKey(query, !!deps.playstationOnly, pageSize);
  const hit = await read(deps.store, key, parseCandidates);
  if (hit && isFresh(hit.fetchedAt, now.getTime(), CATALOG_CACHE_TTL_MS)) {
    return { value: hit.value, fetchedAt: hit.fetchedAt, stale: false, rawgCalls: 0 };
  }
  try {
    const value = await searchCatalog(query, deps);
    const at = now.getTime();
    await deps.store.set(key, 'search', value, at);
    return { value, fetchedAt: at, stale: false, rawgCalls: 1 };
  } catch (e) {
    if (hit) return { value: hit.value, fetchedAt: hit.fetchedAt, stale: true, rawgCalls: 1 };
    throw e;
  }
}

export async function cachedGame(id: string, deps: LoadDeps): Promise<CachedResult<CatalogCandidate | null>> {
  const now = deps.now ?? new Date();
  const key = gameCacheKey(id);
  const row = await deps.store.get(key);
  let hit: { value: CatalogCandidate | null; fetchedAt: number } | null = null;
  if (row) {
    const parsed = parseGame(row.payload);
    if (parsed !== undefined) hit = { value: parsed, fetchedAt: row.fetchedAt };
  }
  if (hit && isFresh(hit.fetchedAt, now.getTime(), CATALOG_GAME_TTL_MS)) {
    return { value: hit.value, fetchedAt: hit.fetchedAt, stale: false, rawgCalls: 0 };
  }
  try {
    const value = await getCatalogGame(id, deps);
    const at = now.getTime();
    await deps.store.set(key, 'game', value, at);
    return { value, fetchedAt: at, stale: false, rawgCalls: 1 };
  } catch (e) {
    if (e instanceof CatalogError && hit) return { value: hit.value, fetchedAt: hit.fetchedAt, stale: true, rawgCalls: 1 };
    throw e;
  }
}

export function asOfIso(fetchedAt: number): string {
  return new Date(fetchedAt).toISOString();
}
