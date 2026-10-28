// Стрик игровых дней и тепловая карта (контракт 14.3). Чистые функции, без БД и текущего времени.
import type { Snapshot } from './hours';
import { daysInMonth, ymd } from './period';

/** Сутки МСК по снимкам: seconds = сумма положительных дельт, deltas = сколько снимков имели предыдущий снимок той же игры. */
export type ActivityDay = { date: string; seconds: number; deltas: number };

export type Streak = { days: number; from: string | null; to: string | null; hasGaps: boolean };

export type ActivityResponse = {
  year: number;
  today: string;
  firstSnapshotDate: string | null;
  days: { date: string; minutes: number | null }[];
  totals: { playedDays: number; knownDays: number; minutes: number; maxMinutes: number };
  streak: { current: Streak; best: Streak; bestInYear: Streak };
};

/**
 * Эталон SQL-агрегата (activity-query.ts): по снимкам строит суточные дельты.
 * Первый снимок игры дельты не даёт; отрицательная дельта = 0. Строка есть для каждой даты, где есть хоть один снимок.
 */
export function dailyActivity(snaps: readonly Snapshot[]): ActivityDay[] {
  const byGame = new Map<number, { date: string; seconds: number }[]>();
  for (const s of snaps) {
    const arr = byGame.get(s.gameId) ?? [];
    arr.push({ date: s.date, seconds: s.seconds });
    byGame.set(s.gameId, arr);
  }
  const out = new Map<string, ActivityDay>();
  for (const arr of byGame.values()) {
    arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    arr.forEach((s, i) => {
      const d = out.get(s.date) ?? { date: s.date, seconds: 0, deltas: 0 };
      out.set(s.date, d);
      if (i === 0) return;
      d.deltas++;
      d.seconds += Math.max(0, s.seconds - arr[i - 1].seconds);
    });
  }
  return [...out.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Следующая календарная дата YYYY-MM-DD (UTC-арифметика по дате, без часового пояса). */
export function nextDate(date: string): string {
  const t = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + 1);
  return new Date(t).toISOString().slice(0, 10);
}

const toMinutes = (sec: number) => (sec > 0 ? Math.max(1, Math.round(sec / 60)) : 0);
const EMPTY: Streak = { days: 0, from: null, to: null, hasGaps: false };

type Run = { dates: string[]; hasGaps: boolean };
type DayState = 'played' | 'zero' | 'unknown';

/**
 * Серии игровых дней по календарю от первого снимка до сегодня. Неизвестный день не рвёт и не удлиняет серию
 * (помечает hasGaps, если внутри серии); рвёт только известный день без игры, кроме сегодня.
 */
function buildRuns(state: (d: string) => DayState, start: string, today: string): Run[] {
  const runs: Run[] = [];
  let cur: Run | null = null;
  let pendingGap = false;
  for (let d = start; d <= today; d = nextDate(d)) {
    const s = state(d);
    if (s === 'played') {
      if (cur) {
        if (pendingGap) cur.hasGaps = true;
        cur.dates.push(d);
      } else {
        cur = { dates: [d], hasGaps: false };
        runs.push(cur);
      }
      pendingGap = false;
    } else if (s === 'unknown') {
      if (cur) pendingGap = true;
    } else if (d !== today) {
      cur = null;
      pendingGap = false;
    }
  }
  return runs;
}

const toStreak = (dates: string[], hasGaps: boolean): Streak =>
  dates.length ? { days: dates.length, from: dates[0], to: dates[dates.length - 1], hasGaps } : EMPTY;

/** Самая длинная серия; при равенстве более поздняя. */
function longest(runs: { dates: string[]; hasGaps: boolean }[]): Streak {
  let best: Streak = EMPTY;
  for (const r of runs) if (r.dates.length && r.dates.length >= best.days) best = toStreak(r.dates, r.hasGaps);
  return best;
}

/**
 * Ответ 14.3. rows: суточные агрегаты всей истории (любой порядок), today: дата МСК сегодня.
 * Известный день = deltas > 0 (первый день синка неизвестен). Будущее неизвестно.
 */
export function buildActivity(args: { rows: readonly ActivityDay[]; year: number; today: string; firstSnapshotDate: string | null }): ActivityResponse {
  const { year, today, firstSnapshotDate } = args;
  const known = new Map<string, number>();
  for (const r of args.rows) if (r.deltas > 0) known.set(r.date, r.seconds);
  const state = (d: string): DayState => {
    if (d > today) return 'unknown';
    const sec = known.get(d);
    return sec === undefined ? 'unknown' : sec > 0 ? 'played' : 'zero';
  };

  const days: ActivityResponse['days'] = [];
  const totals = { playedDays: 0, knownDays: 0, minutes: 0, maxMinutes: 0 };
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= daysInMonth(year, m); d++) {
      const date = ymd(year, m, d);
      const sec = date > today ? undefined : known.get(date);
      const minutes = sec === undefined ? null : toMinutes(sec);
      days.push({ date, minutes });
      if (minutes === null) continue;
      totals.knownDays++;
      totals.minutes += minutes;
      if (minutes > 0) totals.playedDays++;
      if (minutes > totals.maxMinutes) totals.maxMinutes = minutes;
    }
  }

  if (firstSnapshotDate === null || firstSnapshotDate > today) {
    return { year, today, firstSnapshotDate, days, totals, streak: { current: EMPTY, best: EMPTY, bestInYear: EMPTY } };
  }
  const runs = buildRuns(state, firstSnapshotDate, today);

  // текущая: от сегодня назад пропускаем сегодня (если не игровой) и неизвестные дни
  let current: Streak = EMPTY;
  for (let d = today; d >= firstSnapshotDate; d = prevDate(d)) {
    const s = state(d);
    if (s === 'played') {
      const run = runs.find((r) => r.dates.includes(d));
      if (run) current = toStreak(run.dates, run.hasGaps);
      break;
    }
    if (s === 'zero' && d !== today) break;
  }

  const from = ymd(year, 1, 1);
  const to = ymd(year, 12, 31);
  const inYear = runs.map((r) => {
    const dates = r.dates.filter((d) => d >= from && d <= to);
    // внутри серии не-игровые дни бывают только неизвестными, поэтому пропуск = календарный разрыв в обрезанной части
    return { dates, hasGaps: dates.length > 1 && spanDays(dates[0], dates[dates.length - 1]) + 1 > dates.length };
  });

  return { year, today, firstSnapshotDate, days, totals, streak: { current, best: longest(runs), bestInYear: longest(inYear) } };
}

export function prevDate(date: string): string {
  const t = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) - 1);
  return new Date(t).toISOString().slice(0, 10);
}

/** Число суток между датами YYYY-MM-DD (b - a). */
function spanDays(a: string, b: string): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86_400_000);
}
