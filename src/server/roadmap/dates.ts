// Календарная арифметика по датам YYYY-MM-DD (контракт 17.4). Чистые функции, без часовых поясов:
// «сегодня» по МСК приходит снаружи строкой (mskDateString из stats/period.ts).
import { monthRange } from '@/server/stats/period';

const DAY_MS = 86_400_000;

/** Номер дня (дни от 1970-01-01) календарной даты. */
export function dayNum(date: string): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function dayStr(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** Строка YYYY-MM-DD существующей календарной даты (2026-02-30 не проходит). */
export function isDateString(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return dayStr(dayNum(s)) === s;
}

/** Номер дня недели: понедельник = 0 .. воскресенье = 6. 1970-01-01 был четвергом. */
export const weekdayMon0 = (n: number): number => (((n + 3) % 7) + 7) % 7;

export function yearBounds(year: number): { from: string; to: string; days: number } {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  return { from, to, days: dayNum(to) - dayNum(from) + 1 };
}

export type WeekSpan = { index: number; from: string; to: string; days: number };

/**
 * Недели года: понедельник..воскресенье (МСК), первая и последняя обрезаны границами года.
 * Не ISO-нумерация (контракт 17.4): неделя 1 начинается 1 января.
 */
export function weeksOfYear(year: number): WeekSpan[] {
  const b = yearBounds(year);
  const start = dayNum(b.from);
  const end = dayNum(b.to);
  const out: WeekSpan[] = [];
  let from = start;
  while (from <= end) {
    const to = Math.min(end, from + (6 - weekdayMon0(from)));
    out.push({ index: out.length + 1, from: dayStr(from), to: dayStr(to), days: to - from + 1 });
    from = to + 1;
  }
  return out;
}

export type MonthSpan = { month: string; from: string; to: string; days: number };

export function monthsOfYear(year: number): MonthSpan[] {
  return Array.from({ length: 12 }, (_, i) => {
    const r = monthRange(year, i + 1);
    return { month: `${year}-${String(i + 1).padStart(2, '0')}`, from: r.from, to: r.to, days: dayNum(r.to) - dayNum(r.from) + 1 };
  });
}

/** Число общих дней двух отрезков номеров дней (включительно). */
export const overlapDays = (aFrom: number, aTo: number, bFrom: number, bTo: number): number => Math.max(0, Math.min(aTo, bTo) - Math.max(aFrom, bFrom) + 1);
