// Часы за период по ежедневным снимкам (контракт 1.6). Чистые функции.
import { monthRange } from './period';

export type Snapshot = { gameId: number; date: string; seconds: number };

/**
 * Секунды игры за [from, to] (даты МСК включительно, строки YYYY-MM-DD).
 * snaps: снимки ОДНОЙ игры, отсортированные по date по возрастанию.
 * S_end = последний снимок <= to; S_base = последний снимок < from, иначе первый снимок внутри периода.
 * Отрицательная дельта (PSN уменьшил playDuration) = 0.
 */
export function gameSecondsInRange(snaps: readonly { date: string; seconds: number }[], from: string, to: string): number {
  let end: number | null = null;
  let base: number | null = null;
  let firstInside: number | null = null;
  for (const s of snaps) {
    if (s.date > to) break;
    end = s.seconds;
    if (s.date < from) base = s.seconds;
    else if (firstInside === null) firstInside = s.seconds;
  }
  if (end === null) return 0;
  const start = base ?? firstInside;
  if (start === null) return 0;
  return Math.max(0, end - start);
}

export function groupSnapshots(snaps: readonly Snapshot[]): Map<number, { date: string; seconds: number }[]> {
  const by = new Map<number, { date: string; seconds: number }[]>();
  for (const s of snaps) {
    const arr = by.get(s.gameId) ?? [];
    arr.push({ date: s.date, seconds: s.seconds });
    by.set(s.gameId, arr);
  }
  for (const arr of by.values()) arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return by;
}

/** Секунды по каждой игре за период (только > 0). */
export function secondsByGame(by: Map<number, { date: string; seconds: number }[]>, from: string, to: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const [id, arr] of by) {
    const sec = gameSecondsInRange(arr, from, to);
    if (sec > 0) out.set(id, sec);
  }
  return out;
}

export const secondsToHours = (sec: number): number => Math.round(sec / 360) / 10;

/** Есть ли у периода охват снимками (контракт 10.1). today = дата МСК сегодня. */
export function hasCoverage(firstSnapshotDate: string | null, from: string, to: string, today: string): boolean {
  return firstSnapshotDate !== null && to >= firstSnapshotDate && from <= today;
}

export function sumSeconds(m: Map<number, number>): number {
  let t = 0;
  for (const v of m.values()) t += v;
  return t;
}

/** 12 значений по месяцам года: часы или null (нет охвата). */
export function hoursByMonth(
  by: Map<number, { date: string; seconds: number }[]>,
  year: number,
  firstSnapshotDate: string | null,
  today: string,
): (number | null)[] {
  return Array.from({ length: 12 }, (_, i) => {
    const { from, to } = monthRange(year, i + 1);
    if (!hasCoverage(firstSnapshotDate, from, to, today)) return null;
    return secondsToHours(sumSeconds(secondsByGame(by, from, to)));
  });
}
