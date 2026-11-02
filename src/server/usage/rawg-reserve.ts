// Связка счётчика provider_usage с каталогом RAWG для API-роутов (контракт 24.2). Лимиты из env.
import { getDb } from '@/db';
import type { UserId } from '@/server/auth/user-id';
import { getProviderLimits } from '@/server/env';
import { providerUsedToday, reserveProviderCall } from './provider-usage';
import { suggestDailyLimit, takeSuggestQuota } from './suggest-quota';

/** Возвращает `reserve` для CatalogDeps: true = запрос разрешён. Ошибки БД не блокируют (fail-open внутри reserveProviderCall). */
export function rawgReserve(userId: UserId): () => Promise<boolean> {
  return async () => {
    let db;
    try {
      db = getDb();
    } catch {
      return true; // нет DATABASE_URL: счётчик недоступен, не блокируем
    }
    return (await reserveProviderCall(db, userId, 'rawg', new Date(), getProviderLimits('rawg'))) === 'ok';
  };
}

/**
 * `reserve` для подсказок (контракт 43.1.3): сначала мягкий предел подсказок (state.quota = true, RAWG не вызывается, лимит не списывается),
 * затем обычное занятие вызова `rawg`. Вызывается только при промахе кэша.
 */
export function rawgSuggestReserve(userId: UserId, state: { quota: boolean }): () => Promise<boolean> {
  return async () => {
    const limits = getProviderLimits('rawg');
    let db;
    try {
      db = getDb();
    } catch {
      return true;
    }
    const now = new Date();
    const used = await providerUsedToday(db, userId, 'rawg', now);
    if (!takeSuggestQuota({ userId, now, suggestLimit: suggestDailyLimit(process.env.RAWG_SUGGEST_DAILY_LIMIT, limits.userLimit), rawgUserLimit: limits.userLimit, rawgUsedToday: used })) {
      state.quota = true;
      return false;
    }
    return (await reserveProviderCall(db, userId, 'rawg', now, limits)) === 'ok';
  };
}
