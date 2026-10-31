// История игры для окна (контракт 26): часы по неделям МСК (реальные + оценка до первого снимка) и отметки трофеев. Чистые функции.
import { dailyActivity, nextDate } from '@/server/stats/activity';
import { estimateByMonth, estimateDateWindow, type EstimateInput, type Snapshot } from '@/server/stats/hours';
import { mskDateString } from '@/server/stats/period';

export type HistoryWeek = {
  /** Понедельник недели (МСК), YYYY-MM-DD. */
  weekStart: string;
  /** Реальные + оценочные секунды недели. */
  seconds: number;
  /** Оценочная часть seconds (до первого снимка, 1.6). */
  estimatedSeconds: number;
  trophies: number;
  platinum: boolean;
};

export type GameHistory = {
  weeks: HistoryWeek[];
  truncated: boolean;
  hasHours: boolean;
  hasEstimate: boolean;
  playedDays: number | null;
  firstSnapshotDate: string | null;
};

export const MAX_HISTORY_WEEKS = 52;

const dayNumber = (date: string): number => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;
const fromDayNumber = (n: number): string => new Date(n * 86_400_000).toISOString().slice(0, 10);

/** Понедельник недели (пн..вс) для даты МСК YYYY-MM-DD. 1970-01-01 был четвергом. */
export function weekStartOf(date: string): string {
  const n = dayNumber(date);
  const dow = (((n + 3) % 7) + 7) % 7; // 0 = понедельник
  return fromDayNumber(n - dow);
}

/** Следующая неделя (+7 дней). */
const addWeek = (weekStart: string): string => fromDayNumber(dayNumber(weekStart) + 7);

/** Оценка версии по дням: доля месяца делится поровну по дням окна оценки в этом месяце, остаток в последний день. */
export function estimateByDay(i: EstimateInput): Map<string, number> {
  const out = new Map<string, number>();
  const win = estimateDateWindow(i);
  if (win === null) return out;
  const days = new Map<string, string[]>(); // YYYY-MM -> даты окна
  for (let d = win.start; d <= win.end; d = nextDate(d)) {
    const arr = days.get(d.slice(0, 7)) ?? [];
    arr.push(d);
    days.set(d.slice(0, 7), arr);
  }
  for (const [month, seconds] of estimateByMonth(i)) {
    const ds = days.get(month);
    if (!ds || seconds <= 0) continue;
    const share = Math.floor(seconds / ds.length);
    ds.forEach((d, idx) => out.set(d, (out.get(d) ?? 0) + (idx === ds.length - 1 ? share + (seconds - share * ds.length) : share)));
  }
  return out;
}

export type HistoryTrophy = { type: string; earnedAt: string | null };

/**
 * snaps: слитые снимки группы (gameId любой, ряд один; 25.3). estimates: по одной записи на версию (с исключениями 15.1).
 * null, если нет ни снимков, ни трофеев с датой.
 */
export function buildGameHistory(args: { snaps: readonly Snapshot[]; estimates: readonly EstimateInput[]; trophies: readonly HistoryTrophy[] }): GameHistory | null {
  const { snaps, estimates } = args;
  const earned = args.trophies.filter((t) => t.earnedAt !== null);
  if (snaps.length === 0 && earned.length === 0) return null;

  const real = new Map<string, number>(); // weekStart -> секунды
  const est = new Map<string, number>();
  const marks = new Map<string, { trophies: number; platinum: boolean }>();
  let playedDays = 0;
  let firstSnapshotDate: string | null = null;

  for (const s of snaps) if (firstSnapshotDate === null || s.date < firstSnapshotDate) firstSnapshotDate = s.date;
  for (const d of dailyActivity(snaps)) {
    if (d.seconds <= 0) continue;
    playedDays++;
    const w = weekStartOf(d.date);
    real.set(w, (real.get(w) ?? 0) + d.seconds);
  }
  for (const e of estimates) {
    for (const [d, sec] of estimateByDay(e)) {
      const w = weekStartOf(d);
      est.set(w, (est.get(w) ?? 0) + sec);
    }
  }
  for (const t of earned) {
    const w = weekStartOf(mskDateString(new Date(t.earnedAt as string)));
    const m = marks.get(w) ?? { trophies: 0, platinum: false };
    m.trophies++;
    if (t.type === 'platinum') m.platinum = true;
    marks.set(w, m);
  }

  const keys = [...real.keys(), ...est.keys(), ...marks.keys()].sort();
  const weeks: HistoryWeek[] = [];
  if (keys.length > 0) {
    for (let w = keys[0]; w <= keys[keys.length - 1]; w = addWeek(w)) {
      const e = est.get(w) ?? 0;
      const m = marks.get(w);
      weeks.push({ weekStart: w, seconds: (real.get(w) ?? 0) + e, estimatedSeconds: e, trophies: m?.trophies ?? 0, platinum: m?.platinum ?? false });
    }
  }
  const truncated = weeks.length > MAX_HISTORY_WEEKS;
  const shown = truncated ? weeks.slice(weeks.length - MAX_HISTORY_WEEKS) : weeks;
  return {
    weeks: shown,
    truncated,
    hasHours: snaps.length > 0,
    hasEstimate: shown.some((w) => w.estimatedSeconds > 0),
    playedDays: snaps.length > 0 ? playedDays : null,
    firstSnapshotDate,
  };
}
