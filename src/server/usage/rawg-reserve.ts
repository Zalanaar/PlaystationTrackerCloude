// Связка счётчика provider_usage с каталогом RAWG для API-роутов (контракт 24.2). Лимиты из env.
import { getDb } from '@/db';
import type { UserId } from '@/server/auth/user-id';
import { getProviderLimits } from '@/server/env';
import { reserveProviderCall } from './provider-usage';

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
