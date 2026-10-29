// Чистые константы и функции давности синка (контракт 20.2), нужные и серверу, и UI.
export const SYNC_OVERDUE_HOURS = 30;
export const SYNC_OVERDUE_MS = SYNC_OVERDUE_HOURS * 3_600_000;

export type SyncOverdue = { isOverdue: boolean; ageHours: number | null; thresholdHours: number };

/**
 * Давность последнего успешного синка. reference = время последнего успеха, а если успехов не было, время первого запуска;
 * null = запусков нет совсем (проверка не срабатывает).
 */
export function syncOverdue(reference: Date | null, now: Date, thresholdMs: number = SYNC_OVERDUE_MS): SyncOverdue {
  const thresholdHours = thresholdMs / 3_600_000;
  if (!reference) return { isOverdue: false, ageHours: null, thresholdHours };
  const age = Math.max(0, now.getTime() - reference.getTime());
  return { isOverdue: age > thresholdMs, ageHours: Math.round(age / 360_000) / 10, thresholdHours };
}
