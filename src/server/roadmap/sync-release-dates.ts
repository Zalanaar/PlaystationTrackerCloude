// Даты выхода игр с «Хочу пройти на релизе» подтягиваем из каталога (RAWG),
// иначе окно в Плане остаётся на дате, сохранённой при добавлении.
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { isDateString } from './dates';

const { plannedGames: p } = schema;

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
export const RELEASE_REFRESH_TTL_MS = 60 * 60 * 1000;

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
 * Подтянуть даты всех своих игр «на релизе» с rawg id (в том числе не попавших на текущую страницу новинок).
 * Ошибки одной игры пропускаем; кэш процесса — не чаще раза в час на пользователя (как кэш новинок).
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
  const rows = await db
    .select({ externalId: p.externalId })
    .from(p)
    .where(and(
      eq(p.userId, userId),
      eq(p.wantAtRelease, true),
      eq(p.externalSource, 'rawg'),
      isNotNull(p.externalId),
      inArray(p.status, [...LIVE_STATUSES]),
    ));
  const catalog: CatalogDateHint[] = [];
  const skip = deps.skipIds ?? new Set<string>();
  for (const r of rows) {
    if (r.externalId === null || skip.has(r.externalId)) continue;
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
