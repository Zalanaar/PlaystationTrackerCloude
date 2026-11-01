// Остаток часов до конца игры (контракт 17.4, Фаза 32, D3). Чистая функция: без env, БД и сети.
// осталось = max(база − наиграно, 15% базы); база = ручная оценка, иначе HLTB main.

/** Нижняя граница остатка: доля базы, которая «осталась всегда» (титры, финал, хвосты). */
export const REMAINING_MIN_SHARE = 0.15;

const r1 = (n: number): number => Math.round(n * 10) / 10;
const r2 = (n: number): number => Math.round(n * 100) / 100;

export type Remaining = {
  /** Остаток, часы с шагом 0.1 (минимум 0.1), или null, если базы нет. */
  remaining: number | null;
  /** Доля пройденного 0..1 (0.01) = 1 − остаток / база, или null. Потолок 0.85 из-за пола остатка. */
  progress: number | null;
};

/** База: ручная оценка приоритетнее HLTB. Невалидные значения (null, NaN, <= 0) считаются отсутствующими. */
export function pickBaseHours(override: number | null | undefined, hltbMain: number | null | undefined): number | null {
  for (const v of [override, hltbMain]) if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  return null;
}

/** Остаток по базе и наигранным секундам. Нет базы = null. Отрицательные/нечисловые секунды считаются нулём. */
export function remainingHours(base: number | null | undefined, playedSeconds: number | null | undefined): Remaining {
  if (typeof base !== 'number' || !Number.isFinite(base) || base <= 0) return { remaining: null, progress: null };
  const played = typeof playedSeconds === 'number' && Number.isFinite(playedSeconds) && playedSeconds > 0 ? playedSeconds / 3600 : 0;
  const raw = Math.max(base - played, base * REMAINING_MIN_SHARE);
  const remaining = Math.max(0.1, r1(raw));
  const progress = Math.min(1, Math.max(0, r2(1 - raw / base)));
  return { remaining, progress };
}
