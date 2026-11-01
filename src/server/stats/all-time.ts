// Статистика «за всё время» (контракт 26.1): чистые расчёты, без БД и текущего времени.
import type { GameItem } from '@/server/collection/types';
import { mergeDuplicateSnapshots, type DuplicateMap } from './duplicates';
import { aggregateGenresWithGames, type GenreGameInfo } from './genre-stats';
import { estimateByMonth, groupSnapshots, secondsByGame, sumSeconds, type EstimateInput, type Snapshot } from './hours';
import { buildPlayPattern, type PatternCell } from './play-pattern';
import { mskMidnightUtc, ymd } from './period';
import { rankByHours, rankByTrophies, type GameTrophyCount } from './top';
import { emptyTrophyCounts, type TrophyType } from './trophies';
import type { AllPeriod, HoursYear, RareTrophy, StatsResponse, StatsTop, TrophyCountsByType } from './types';

/** Годы по возрастанию без пропусков: от самого раннего из `years` до максимума (текущий год входит в `years` всегда). */
export function yearRange(years: readonly number[]): number[] {
  if (years.length === 0) return [];
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

export type SnapshotPoint = { gameId: number; date: string; seconds: number };

export type HoursByYearResult = {
  /** header.hours: сумма PSN playDuration видимых игр (с дублями), десятые; null = нет видимых игр. */
  total: number | null;
  byYear: HoursYear[];
  /** total - sum(byYear.hours), десятые; 0, если total = null. */
  unattributed: number;
  estimatedHours: number;
};

const tenths = (sec: number): number => Math.round(sec / 360);

/**
 * Часы по годам (26.1). Снимки приходят «разреженными»: первый снимок игры и последний снимок игры в каждом году;
 * этого достаточно для формулы 1.6 по периоду «год» (база = последний снимок прошлых лет, иначе первый снимок игры).
 * estimates: уже с исключениями 15.1 и id главной (25.3). totalSeconds = sum(effective play_duration_seconds), null = нет игр.
 * Всё сводится в целые десятые, поэтому sum(byYear.hours) + unattributed == total точно.
 */
export function calcHoursByYear(args: {
  points: readonly SnapshotPoint[];
  estimates: readonly EstimateInput[];
  dup: DuplicateMap;
  totalSeconds: number | null;
  years: readonly number[];
}): HoursByYearResult {
  const { estimates, dup, totalSeconds } = args;
  const range = yearRange(args.years);
  // дедуп (игра, дата): первый и последний снимок года могут быть одной строкой
  const uniq = new Map<string, Snapshot>();
  for (const p of args.points) uniq.set(`${p.gameId}|${p.date}`, p);
  const by = groupSnapshots(mergeDuplicateSnapshots([...uniq.values()], dup));
  const estByYear = new Map<number, number>();
  for (const inp of estimates) {
    for (const [k, v] of estimateByMonth(inp)) {
      const y = Number(k.slice(0, 4));
      estByYear.set(y, (estByYear.get(y) ?? 0) + v);
    }
  }
  const byYear: HoursYear[] = range.map((year) => {
    const measuredSec = sumSeconds(secondsByGame(by, ymd(year, 1, 1), ymd(year, 12, 31)));
    const estSec = estByYear.get(year) ?? 0;
    const hoursT = tenths(measuredSec + estSec);
    const estT = Math.min(tenths(estSec), hoursT);
    return { year, hours: hoursT / 10, estimatedHours: estT / 10, measuredHours: (hoursT - estT) / 10 };
  });
  if (totalSeconds === null) return { total: null, byYear, unattributed: 0, estimatedHours: sumTenths(byYear, 'estimatedHours') };
  const totalT = tenths(totalSeconds);
  const sumT = byYear.reduce((a, r) => a + Math.round(r.hours * 10), 0);
  return { total: totalT / 10, byYear, unattributed: (totalT - sumT) / 10, estimatedHours: sumTenths(byYear, 'estimatedHours') };
}

const sumTenths = (rows: readonly HoursYear[], k: 'estimatedHours'): number => rows.reduce((a, r) => a + Math.round(r[k] * 10), 0) / 10;

export type TrophyYearRow = { year: number; type: TrophyType; n: number };
export type FinishedYearRow = { year: number; kind: 'completed' | 'dropped'; n: number };

export function trophiesByYear(rows: readonly TrophyYearRow[], years: readonly number[]): { counts: TrophyCountsByType; byYear: (TrophyCountsByType & { year: number })[] } {
  const counts = emptyTrophyCounts();
  const range = new Set(yearRange(years));
  for (const r of rows) range.add(r.year); // трофей вне списка лет не теряется
  const list = [...range].sort((a, b) => a - b);
  const by = new Map<number, TrophyCountsByType & { year: number }>(list.map((y) => [y, { year: y, ...emptyTrophyCounts() }]));
  for (const r of rows) {
    if (r.n <= 0) continue;
    const c = by.get(r.year);
    if (!c) continue;
    c[r.type] += r.n;
    c.total += r.n;
    counts[r.type] += r.n;
    counts.total += r.n;
  }
  return { counts, byYear: list.map((y) => by.get(y) as TrophyCountsByType & { year: number }) };
}

export function finishedByYear(rows: readonly FinishedYearRow[], years: readonly number[]): { completed: number; dropped: number; byYear: { year: number; completed: number; dropped: number }[] } {
  const range = new Set(yearRange(years));
  for (const r of rows) range.add(r.year);
  const list = [...range].sort((a, b) => a - b);
  const by = new Map<number, { year: number; completed: number; dropped: number }>(list.map((y) => [y, { year: y, completed: 0, dropped: 0 }]));
  let completed = 0;
  let dropped = 0;
  for (const r of rows) {
    const c = by.get(r.year);
    if (!c || r.n <= 0) continue;
    c[r.kind] += r.n;
    if (r.kind === 'completed') completed += r.n;
    else dropped += r.n;
  }
  return { completed, dropped, byYear: list.map((y) => by.get(y) as { year: number; completed: number; dropped: number }) };
}

/** Период «всё время»: первая и последняя даты данных (МСК, YYYY-MM-DD) или null. */
export function allPeriod(year: number, first: string | null, last: string | null): AllPeriod {
  if (first === null || last === null) return { type: 'all', year, month: null, from: null, to: null, fromUtc: null, toUtc: null };
  const [ty, tm, td] = last.split('-').map(Number);
  const [fy, fm, fd] = first.split('-').map(Number);
  return {
    type: 'all',
    year,
    month: null,
    from: first,
    to: last,
    fromUtc: mskMidnightUtc(fy, fm, fd).toISOString(),
    toUtc: mskMidnightUtc(ty, tm, td + 1).toISOString(),
  };
}

export type AllGameRow = GenreGameInfo & { /** Статус completed/dropped (когда-либо). */ finishedEver: boolean };

export type StatsAllInput = {
  period: AllPeriod;
  years: number[];
  firstSnapshotDate: string | null;
  hours: HoursByYearResult;
  trophyYears: TrophyYearRow[];
  finishedYears: FinishedYearRow[];
  /** Видимые игры: секунды = суммарные PSN (с дублями). */
  games: readonly AllGameRow[];
  trophiesByGame: readonly GameTrophyCount[];
  gameById: ReadonlyMap<number, GameItem>;
  rare: RareTrophy[];
  patternCells: readonly PatternCell[];
};

/** Игры для топа и жанров: id -> суммарные секунды PSN. */
export function allSeconds(games: readonly { id: number; seconds: number }[]): Map<number, number> {
  return new Map(games.filter((g) => g.seconds > 0).map((g) => [g.id, g.seconds] as const));
}

/** Сколько игр попадёт в топы: id для загрузки карточек (до компоновки). */
export function topIds(games: readonly AllGameRow[], trophiesByGame: readonly GameTrophyCount[]): number[] {
  const titles = new Map(games.map((g) => [g.id, g.title] as const));
  const ids = new Set<number>();
  for (const r of rankByHours(allSeconds(games), new Map(), titles)) ids.add(r.gameId);
  for (const r of rankByTrophies(trophiesByGame, titles)) ids.add(r.gameId);
  return [...ids];
}

export function composeStatsAll(i: StatsAllInput): StatsResponse {
  const titles = new Map(i.games.map((g) => [g.id, g.title] as const));
  const secs = allSeconds(i.games);
  const top: StatsTop = {
    byHours: rankByHours(secs, new Map(), titles).flatMap((r) => {
      const game = i.gameById.get(r.gameId);
      return game ? [{ game, hours: r.hours, estimated: false }] : [];
    }),
    byTrophies: rankByTrophies(i.trophiesByGame, titles).flatMap((r) => {
      const game = i.gameById.get(r.gameId);
      return game ? [{ game, points: r.points, counts: r.counts }] : [];
    }),
  };
  const genreList = i.games.filter((g) => g.seconds > 0 || g.finishedEver);
  const tr = trophiesByYear(i.trophyYears, i.years);
  const fin = finishedByYear(i.finishedYears, i.years);
  const h = i.hours;
  return {
    period: i.period,
    years: i.years,
    header: { completed: fin.completed, dropped: fin.dropped, hours: h.total, platinum: tr.counts.platinum },
    hours: {
      byMonth: new Array<null>(12).fill(null),
      estimatedByMonth: new Array<number>(12).fill(0),
      estimatedHours: h.estimatedHours,
      hasEstimate: h.estimatedHours > 0,
      firstSnapshotDate: i.firstSnapshotDate,
      periodPartial: i.firstSnapshotDate === null || h.estimatedHours > 0 || h.unattributed !== 0,
      byYear: h.byYear,
      unattributed: h.unattributed,
    },
    genres: aggregateGenresWithGames(genreList),
    top,
    rareTrophies: { period: i.rare, allTime: i.rare },
    trophies: { counts: tr.counts, byMonth: Array.from({ length: 12 }, (_, k) => ({ month: k + 1, ...emptyTrophyCounts() })), byYear: tr.byYear },
    finished: { groups: [], byYear: fin.byYear },
    played: { games: {}, groups: [] },
    playPattern: buildPlayPattern(i.patternCells),
  };
}
