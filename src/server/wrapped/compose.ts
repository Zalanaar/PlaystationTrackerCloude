// Сборка ответа /api/wrapped из сырых данных (контракт 11.1). Без БД и текущего времени.
import type { GameItem } from '@/server/collection/types';
import type { FinishedEvent } from '@/server/stats/finished';
import { aggregateGenres, type GenreGame } from '@/server/stats/genre-stats';
import { calcHours, groupSnapshots, type EstimateInput, type Snapshot } from '@/server/stats/hours';
import { resolvePeriod } from '@/server/stats/period';
import { aggregateTrophies, type EarnedTrophy } from '@/server/stats/trophies';
import { peakMonth, pickPlatinums, splitFinished, topGamesBySeconds } from './calc';
import type { WrappedPlatinum, WrappedResponse, WrappedSlideId } from './types';

export const WRAPPED_GENRES_TOP = 3;

export type WrappedInput = {
  year: number;
  today: string;
  years: { year: number; hasData: boolean }[];
  onlineId: string | null;
  snapshots: Snapshot[];
  estimates: EstimateInput[];
  firstSnapshotDate: string | null;
  /** Трофеи с earned_at внутри года. */
  trophies: EarnedTrophy[];
  platinums: WrappedPlatinum[];
  /** Пройдено/брошено, уже отфильтровано по году. */
  finishedEvents: FinishedEvent[];
  gameById: ReadonlyMap<number, GameItem>;
  genreGames: ReadonlyMap<number, GenreGame>;
};

export function composeWrapped(i: WrappedInput): WrappedResponse {
  const p = resolvePeriod('year', i.year, null);
  const by = groupSnapshots(i.snapshots);
  const h = calcHours({ by, estimates: i.estimates, period: p, year: i.year, firstSnapshotDate: i.firstSnapshotDate, today: i.today });
  const { seconds, totalHours, byMonth } = h;
  const hoursHas = totalHours !== null && totalHours > 0;
  const peak = hoursHas ? peakMonth(byMonth) : null;

  const top = hoursHas ? topGamesBySeconds(seconds, i.gameById, h.estimatedSeconds) : [];
  const { counts } = aggregateTrophies(i.trophies, new Date(p.fromUtc), new Date(p.toUtc), i.year);
  const fin = splitFinished(i.finishedEvents, i.gameById);
  const finHas = fin.completed.count + fin.dropped.count > 0;

  const genreIds = new Set<number>(seconds.keys());
  for (const e of i.finishedEvents) genreIds.add(e.gameId);
  const genreList: GenreGame[] = [];
  for (const id of genreIds) {
    const g = i.genreGames.get(id);
    if (g) genreList.push(g);
  }
  const genres = aggregateGenres(genreList, WRAPPED_GENRES_TOP);

  const leader = top[0] ?? null;
  const trophiesHas = counts.total > 0;
  const empty = !hoursHas && !trophiesHas && !finHas;

  const slides: WrappedSlideId[] = empty
    ? ['empty']
    : [
        'start',
        ...(hoursHas ? (['hours'] as const) : []),
        ...(top.length ? (['topGames'] as const) : []),
        ...(finHas ? (['finished'] as const) : []),
        ...(trophiesHas ? (['trophies'] as const) : []),
        ...(genres.hasData ? (['genres'] as const) : []),
        ...(leader ? (['longestGame'] as const) : []),
        'final',
      ];

  return {
    year: i.year,
    mode: empty ? 'empty' : 'story',
    period: { from: p.from, to: p.to, fromUtc: p.fromUtc, toUtc: p.toUtc },
    years: i.years,
    profile: { onlineId: i.onlineId },
    firstSnapshotDate: i.firstSnapshotDate,
    periodPartial: i.firstSnapshotDate === null || p.from < i.firstSnapshotDate,
    slides,
    hours: {
      hasData: hoursHas,
      total: totalHours,
      days: totalHours === null ? null : Math.round(totalHours / 2.4) / 10,
      byMonth,
      estimatedByMonth: h.estimatedByMonth,
      estimatedHours: h.estimatedHours,
      hasEstimate: h.hasEstimate,
      topMonth: peak ? { month: peak.month, hours: peak.value } : null,
    },
    topGames: { hasData: top.length > 0, items: top },
    finished: { hasData: finHas, ...fin },
    trophies: { hasData: trophiesHas, counts, platinum: pickPlatinums(i.platinums) },
    genres,
    longestGame: leader
      ? { hasData: true, seconds: leader.seconds, hours: leader.hours, estimated: leader.estimated, playCount: leader.game.playCount, game: leader.game }
      : { hasData: false, seconds: 0, hours: 0, estimated: false, playCount: 0, game: null },
    emptyState: empty ? { syncStartedOn: i.firstSnapshotDate } : null,
  };
}
