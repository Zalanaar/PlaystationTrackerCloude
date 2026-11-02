// Клиентский кэш подсказок (43.1). Флаги duplicate/inBacklog привязаны к состоянию записей, поэтому у кэша есть TTL и сброс при любой правке manual-games.
import type { SearchCandidate } from './manual';

/** Жизнь записи кэша: не дольше серверного кэша (10 мин). */
export const SUGGEST_CACHE_TTL_MS = 10 * 60 * 1000;

const store = new Map<string, { at: number; list: SearchCandidate[] }>();

export function suggestCacheGet(key: string, now: number = Date.now()): SearchCandidate[] | null {
  const e = store.get(key);
  if (!e) return null;
  if (now - e.at > SUGGEST_CACHE_TTL_MS) { store.delete(key); return null; }
  return e.list;
}
export const suggestCacheSet = (key: string, list: SearchCandidate[], now: number = Date.now()): void => { store.set(key, { at: now, list }); };
/** Сброс при добавлении, «Купил», «Убрать» и смене профиля. */
export const suggestCacheClear = (): void => { store.clear(); };
