// Суточное обновление дат «на релизе»: вызывается из существующего daily cron, без нового слота Vercel.
import { getDb } from '@/db';
import { getOwnerUserId } from '@/server/auth/users';
import { cachedGame, dbCatalogCache } from '@/server/catalog/cache';
import { getRawgKey } from '@/server/env';
import { rawgReserve } from '@/server/usage/rawg-reserve';
import { refreshDuePlannedReleaseDates, type RefreshDueResult } from './sync-release-dates';

export async function runDailyPlannedDateRefresh(now = new Date()): Promise<RefreshDueResult | null> {
  const apiKey = getRawgKey();
  if (!apiKey) return null;
  const db = getDb();
  const owner = await getOwnerUserId(db);
  if (!owner) return null;
  const store = dbCatalogCache(db);
  return refreshDuePlannedReleaseDates(db, {
    fetchGame: async (id) => {
      const r = await cachedGame(id, { apiKey, reserve: rawgReserve(owner), store, now });
      return r.value ? { externalId: id, releaseDate: r.value.releaseDate } : null;
    },
    store,
    now,
  });
}
