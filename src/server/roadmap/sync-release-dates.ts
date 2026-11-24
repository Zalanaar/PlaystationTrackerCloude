// Даты выхода игр с «Хочу пройти на релизе» подтягиваем из каталога (RAWG),
// иначе окно в Плане остаётся на дате, сохранённой при добавлении.
// Сетевые запросы — не чаще раза в сутки, пачкой, только будущие даты; на открытии страницы RAWG не вызываем.
import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { CATALOG_GAME_TTL_MS, gameCacheKey, isFresh, plannedRefreshJobKey, type CatalogCacheStore } from '@/server/catalog/cache';
import { mskDateString } from '@/server/stats/period';
import { isDateString } from './dates';

const { plannedGames: p } = schema;

function parseHint(p: unknown): CatalogDateHint | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as { externalId?: unknown; releaseDate?: unknown };
  if (typeof o.externalId !== 'string' || !o.externalId) return null;
  const d = o.releaseDate;
  if (!(d === null || typeof d === 'string')) return null;
  return { externalId: o.externalId, releaseDate: d };
}


export type CatalogDateHint = { externalId: string; releaseDate: string | null };
export type ReleaseDateChange = { id: number; externalId: string; from: string; to: string };

const LIVE_STATUSES = ['planned', 'cancelled'] as const;

/** Обновить release_date у своих игр с галкой «на релизе» и тем же rawg id, если каталог принёс другую валидную дату. Пустую/TBA не пишем: галка требует дату. */
export async function applyCatalogReleaseDates(
  db: AnyDb,
  userId: UserId,
  catalog: readonly CatalogDateHint[],
): Promise<ReleaseDateChange[]> {
  const byId = new Map<string, string>();
  for (const c of catalog) {
    const id = c.externalId.trim();
    if (id && isDateString(c.releaseDate)) byId.set(id, c.releaseDate);
  }
  if (byId.size === 0) return [];
  const rows = await db
    .select({
      id: p.id,
      externalId: p.externalId,
      releaseDate: p.releaseDate,
      status: p.status,
    })
    .from(p)
    .where(and(
      eq(p.userId, userId),
      eq(p.wantAtRelease, true),
      eq(p.externalSource, 'rawg'),
      inArray(p.externalId, [...byId.keys()]),
      inArray(p.status, [...LIVE_STATUSES]),
    ));
  const out: ReleaseDateChange[] = [];
  const now = new Date();
  for (const r of rows) {
    if (r.externalId === null || r.releaseDate === null) continue;
    const to = byId.get(r.externalId);
    if (!to || to === r.releaseDate) continue;
    await db.update(p).set({ releaseDate: to, updatedAt: now }).where(and(eq(p.id, r.id), eq(p.userId, userId)));
    out.push({ id: r.id, externalId: r.externalId, from: r.releaseDate, to });
  }
  return out;
}

export type ReleaseRefreshCache = Map<UserId, number>;
const processRefreshCache: ReleaseRefreshCache = new Map();
/** Не чаще раза в сутки на пользователя (память процесса). Главный затвор в проде — ключ дня в catalog_cache. */
export const RELEASE_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;
export const PLANNED_REFRESH_MAX_FETCHES = 40;

export type RefreshPlannedDatesDeps = {
  fetchGame: (externalId: string) => Promise<CatalogDateHint | null>;
  /** Уже применённые на этой странице каталога id — повторно в RAWG не ходим. */
  skipIds?: ReadonlySet<string>;
  now?: number;
  ttlMs?: number;
  cache?: ReleaseRefreshCache;
  force?: boolean;
};

/**
 * Подтянуть даты своих игр «на релизе» с rawg id и датой сегодня/в будущем.
 * Ошибки одной игры пропускаем; не чаще раза в сутки на пользователя.
 */
export async function refreshPlannedReleaseDates(
  db: AnyDb,
  userId: UserId,
  deps: RefreshPlannedDatesDeps,
): Promise<ReleaseDateChange[]> {
  const now = deps.now ?? Date.now();
  const cache = deps.cache ?? processRefreshCache;
  const ttl = deps.ttlMs ?? RELEASE_REFRESH_TTL_MS;
  if (!deps.force && cache.has(userId) && now - (cache.get(userId) ?? 0) < ttl && now >= (cache.get(userId) ?? 0)) {
    return [];
  }
  const today = mskDateString(new Date(now));
  const rows = await db
    .select({ externalId: p.externalId, releaseDate: p.releaseDate })
    .from(p)
    .where(and(
      eq(p.userId, userId),
      eq(p.wantAtRelease, true),
      eq(p.externalSource, 'rawg'),
      isNotNull(p.externalId),
      gte(p.releaseDate, today),
      inArray(p.status, [...LIVE_STATUSES]),
    ));
  const catalog: CatalogDateHint[] = [];
  const skip = deps.skipIds ?? new Set<string>();
  for (const r of rows) {
    if (r.externalId === null || skip.has(r.externalId)) continue;
    if (!r.releaseDate || !isDateString(r.releaseDate) || r.releaseDate < today) continue;
    try {
      const g = await deps.fetchGame(r.externalId);
      if (g) catalog.push({ externalId: r.externalId, releaseDate: g.releaseDate });
    } catch {
      // одну игру пропускаем, остальные обновляем
    }
  }
  const updated = await applyCatalogReleaseDates(db, userId, catalog);
  cache.set(userId, now);
  return updated;
}

export type RefreshDueResult = { fetched: number; updated: number; users: number; skipped: boolean };

/**
 * Суточное обновление дат по всем пользователям: уникальные rawg id, не больше maxFetches живых запросов.
 * Повтор в тот же день МСК — no-op (ключ в store).
 */
export async function refreshDuePlannedReleaseDates(
  db: AnyDb,
  deps: {
    fetchGame: (externalId: string) => Promise<CatalogDateHint | null>;
    store: CatalogCacheStore;
    now?: Date;
    maxFetches?: number;
  },
): Promise<RefreshDueResult> {
  const now = deps.now ?? new Date();
  const today = mskDateString(now);
  const jobKey = plannedRefreshJobKey(today);
  const job = await deps.store.get(jobKey);
  if (job && isFresh(job.fetchedAt, now.getTime(), RELEASE_REFRESH_TTL_MS)) {
    return { fetched: 0, updated: 0, users: 0, skipped: true };
  }
  const rows = await db
    .select({ userId: p.userId, externalId: p.externalId, releaseDate: p.releaseDate })
    .from(p)
    .where(and(
      eq(p.wantAtRelease, true),
      eq(p.externalSource, 'rawg'),
      isNotNull(p.externalId),
      gte(p.releaseDate, today),
      inArray(p.status, [...LIVE_STATUSES]),
    ));
  const byUser = new Map<UserId, CatalogDateHint[]>();
  const seen = new Map<string, CatalogDateHint | 'fail'>();
  let fetched = 0;
  const cap = deps.maxFetches ?? PLANNED_REFRESH_MAX_FETCHES;
  let incomplete = false;
  const ts = now.getTime();
  for (const r of rows) {
    if (r.externalId === null || !r.releaseDate) continue;
    const uid = r.userId as UserId;
    let hint = seen.get(r.externalId);
    if (hint === undefined) {
      const cached = await deps.store.get(gameCacheKey(r.externalId));
      const fromCache = cached && isFresh(cached.fetchedAt, ts, CATALOG_GAME_TTL_MS) ? parseHint(cached.payload) : null;
      if (fromCache) {
        hint = fromCache;
      } else if (fetched >= cap) {
        incomplete = true;
        continue;
      } else {
        try {
          fetched += 1;
          const g = await deps.fetchGame(r.externalId);
          hint = g ? { externalId: r.externalId, releaseDate: g.releaseDate } : 'fail';
          if (hint !== 'fail') await deps.store.set(gameCacheKey(r.externalId), 'game', hint, ts);
        } catch {
          hint = 'fail';
        }
      }
      seen.set(r.externalId, hint);
    }
    if (hint === 'fail') continue;
    const list = byUser.get(uid) ?? [];
    list.push(hint);
    byUser.set(uid, list);
  }
  let updated = 0;
  for (const [uid, catalog] of byUser) {
    updated += (await applyCatalogReleaseDates(db, uid, catalog)).length;
  }
  if (!incomplete) await deps.store.set(jobKey, 'meta', { ok: true }, now.getTime());
  return { fetched, updated, users: byUser.size, skipped: false };
}
