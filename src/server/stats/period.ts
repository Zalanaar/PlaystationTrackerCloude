// Границы периодов в Europe/Moscow (UTC+3 круглый год, без перехода на летнее время). Чистые функции.
import type { BoundedPeriod, BoundedPeriodType } from './types';

const MSK_OFFSET_MS = 3 * 3600 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

/** Полночь МСК даты (y, m 1..12, d) в UTC. Допускает переполнение m/d (Date.UTC нормализует). */
export function mskMidnightUtc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d) - MSK_OFFSET_MS);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Момент UTC -> календарная дата МСК. */
export function mskDate(at: Date): { year: number; month: number; day: number } {
  const s = new Date(at.getTime() + MSK_OFFSET_MS);
  return { year: s.getUTCFullYear(), month: s.getUTCMonth() + 1, day: s.getUTCDate() };
}

export function mskDateString(at: Date): string {
  const { year, month, day } = mskDate(at);
  return ymd(year, month, day);
}

export function resolvePeriod(type: BoundedPeriodType, year: number, month: number | null): BoundedPeriod {
  const m = type === 'month' ? (month as number) : null;
  const startMonth = m ?? 1;
  const endMonth = m ?? 12;
  const lastDay = daysInMonth(year, endMonth);
  return {
    type,
    year,
    month: m,
    from: ymd(year, startMonth, 1),
    to: ymd(year, endMonth, lastDay),
    fromUtc: mskMidnightUtc(year, startMonth, 1).toISOString(),
    toUtc: mskMidnightUtc(year, endMonth, lastDay + 1).toISOString(),
  };
}

/** Диапазон дат МСК месяца (включительно). */
export function monthRange(year: number, month: number): { from: string; to: string } {
  return { from: ymd(year, month, 1), to: ymd(year, month, daysInMonth(year, month)) };
}
