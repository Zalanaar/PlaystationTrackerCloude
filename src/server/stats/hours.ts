// Часы за период по ежедневным снимкам (контракт 1.6). Чистые функции.
import { mskDateString, monthRange } from './period';

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

/** Вход оценки (контракт 1.6): первый снимок игры (D0, S0, L0) и first_played_at из games. */
export type EstimateInput = {
  gameId: number;
  /** D0: min(snapshot_date) игры, YYYY-MM-DD (МСК). */
  firstSnapshotDate: string;
  /** S0: playDuration в первом снимке, секунды. */
  firstSeconds: number;
  firstPlayedAt: Date | null;
  /** L0: last_played_at первого снимка игры (fallback games.last_played_at), НЕ текущий games.last_played_at. */
  lastPlayedAt: Date | null;
};

const monthKey = (date: string) => date.slice(0, 7);
const nextMonth = (key: string): string => {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

/**
 * Оценочные секунды игры по месяцам МСК (ключ YYYY-MM), контракт 1.6. Пустая карта = оценки нет.
 * S0 делится поровну по месяцам [месяц firstPlayedAt .. месяц min(L0, D0)], остаток целиком в последний.
 */
export function estimateByMonth(i: EstimateInput): Map<string, number> {
  const out = new Map<string, number>();
  if (i.firstPlayedAt === null || i.firstSeconds <= 0) return out;
  const first = mskDateString(i.firstPlayedAt);
  if (first > i.firstSnapshotDate) return out;
  const last = i.lastPlayedAt === null ? null : mskDateString(i.lastPlayedAt);
  const endDate = last === null || last < first ? first : last < i.firstSnapshotDate ? last : i.firstSnapshotDate;
  const startKey = monthKey(first);
  const endKey = monthKey(endDate);
  const keys: string[] = [];
  for (let k = startKey; k <= endKey; k = nextMonth(k)) keys.push(k);
  const n = keys.length;
  const share = Math.floor(i.firstSeconds / n);
  keys.forEach((k, idx) => out.set(k, idx === n - 1 ? share + (i.firstSeconds - share * n) : share));
  return out;
}

/** Оценочные секунды по играм за целые месяцы периода [from, to] (даты МСК). Только > 0. */
export function estimateSecondsByGame(inputs: readonly EstimateInput[], from: string, to: string): Map<number, number> {
  const fromKey = monthKey(from);
  const toKey = monthKey(to);
  const out = new Map<number, number>();
  for (const inp of inputs) {
    let sum = 0;
    for (const [k, v] of estimateByMonth(inp)) if (k >= fromKey && k <= toKey) sum += v;
    if (sum > 0) out.set(inp.gameId, sum);
  }
  return out;
}

/**
 * Годы, в которые оценка даёт ненулевые часы: сумма долей всех игр за год, округлённая как в calcHours (secondsToHours > 0).
 * Год с долей < 0.05 ч «данных» не даёт: Итоги откроются как empty.
 */
export function estimateYears(inputs: readonly EstimateInput[]): number[] {
  const byYear = new Map<number, number>();
  for (const inp of inputs) {
    for (const [k, v] of estimateByMonth(inp)) {
      const y = Number(k.slice(0, 4));
      byYear.set(y, (byYear.get(y) ?? 0) + v);
    }
  }
  return [...byYear].filter(([, sec]) => secondsToHours(sec) > 0).map(([y]) => y);
}

export type HoursCalc = {
  /** Секунды по играм за период: реальные + оценка (только > 0). */
  seconds: Map<number, number>;
  /** Оценочная часть секунд по играм за период (только > 0). */
  estimatedSeconds: Map<number, number>;
  /** header.hours / hours.total: null, если нет охвата и нет оценки. */
  totalHours: number | null;
  estimatedHours: number;
  hasEstimate: boolean;
  /** 12 месяцев года: полные часы (реальные + оценка) или null. */
  byMonth: (number | null)[];
  /** 12 месяцев года: оценочная часть, 0 если нет. */
  estimatedByMonth: number[];
};

/** Единый расчёт часов для Статистики и Wrapped (контракт 1.6, 10.1, 11.1). */
export function calcHours(args: {
  by: Map<number, { date: string; seconds: number }[]>;
  estimates: readonly EstimateInput[];
  period: { from: string; to: string };
  year: number;
  firstSnapshotDate: string | null;
  today: string;
}): HoursCalc {
  const { by, estimates, period, year, firstSnapshotDate, today } = args;
  const real = secondsByGame(by, period.from, period.to);
  const estimatedSeconds = estimateSecondsByGame(estimates, period.from, period.to);
  const seconds = new Map(real);
  for (const [id, v] of estimatedSeconds) seconds.set(id, (seconds.get(id) ?? 0) + v);
  const estTotal = sumSeconds(estimatedSeconds);
  const covered = hasCoverage(firstSnapshotDate, period.from, period.to, today);

  const byMonth: (number | null)[] = [];
  const estimatedByMonth: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const r = monthRange(year, m);
    const est = sumSeconds(estimateSecondsByGame(estimates, r.from, r.to));
    estimatedByMonth.push(secondsToHours(est));
    if (!hasCoverage(firstSnapshotDate, r.from, r.to, today) && est === 0) {
      byMonth.push(null);
      continue;
    }
    byMonth.push(secondsToHours(sumSeconds(secondsByGame(by, r.from, r.to)) + est));
  }
  return {
    seconds,
    estimatedSeconds,
    totalHours: covered || estTotal > 0 ? secondsToHours(sumSeconds(seconds)) : null,
    estimatedHours: secondsToHours(estTotal),
    hasEstimate: estTotal > 0,
    byMonth,
    estimatedByMonth,
  };
}
