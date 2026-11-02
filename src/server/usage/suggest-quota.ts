// Фаза 43.1 (контракт 43.1.3): мягкий дневной предел подсказок поиска RAWG на профиль.
// Новой таблицы/провайдера нет: свой счётчик в памяти процесса (мягкий, на serverless не общий) + проверка общей доли provider_usage.
// Без env и сети: лимиты приходят аргументами.
import type { UserId } from '@/server/auth/user-id';
import { mskDateString } from '@/server/stats/period';

export const SUGGEST_DEFAULT_DAILY_LIMIT = 30;
/** Подсказки не заходят за эту долю суточного лимита RAWG на профиль: остаток для «У тебя нет», Плана и поиска по Enter. */
export const SUGGEST_RAWG_SHARE = 0.8;

const counts = new Map<string, number>();

/** Лимит подсказок: RAWG_SUGGEST_DAILY_LIMIT (по умолчанию 30), не больше половины лимита RAWG на профиль; 0 = выключены. */
export function suggestDailyLimit(rawEnv: string | undefined, rawgUserLimit: number): number {
  const n = rawEnv === undefined || rawEnv.trim() === '' ? SUGGEST_DEFAULT_DAILY_LIMIT : Number(rawEnv);
  const v = Number.isInteger(n) && n >= 0 ? n : SUGGEST_DEFAULT_DAILY_LIMIT;
  return Math.min(v, Math.floor(rawgUserLimit / 2));
}

export type SuggestQuotaInput = { userId: UserId; now: Date; suggestLimit: number; rawgUserLimit: number; rawgUsedToday: number };

/** true = можно сделать реальный запрос подсказки (и счётчик увеличен). */
export function takeSuggestQuota(i: SuggestQuotaInput): boolean {
  const day = mskDateString(i.now);
  for (const k of counts.keys()) if (!k.startsWith(`${day}|`)) counts.delete(k);
  const key = `${day}|${i.userId}`;
  const mine = counts.get(key) ?? 0;
  if (mine >= i.suggestLimit) return false;
  if (i.rawgUsedToday >= Math.floor(i.rawgUserLimit * SUGGEST_RAWG_SHARE)) return false;
  counts.set(key, mine + 1);
  return true;
}

/** Только для тестов. */
export function resetSuggestQuotaMemory(): void {
  counts.clear();
}
