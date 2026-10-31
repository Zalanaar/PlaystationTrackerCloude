// Итоги «за всё время» (контракт 26.2): чистая сборка ответа, без БД и текущего времени.
import type { GameItem } from '@/server/collection/types';
import type { AllGameRow } from '@/server/stats/all-time';
import { allSeconds } from '@/server/stats/all-time';
import { buildPlayPattern, type PatternCell } from '@/server/stats/play-pattern';
import type { AllPeriod, RareTrophy, StatsResponse } from '@/server/stats/types';
import { pickPlatinums, topGamesBySeconds } from './calc';
import type { WrappedAllTime, WrappedPlatinum, WrappedResponse, WrappedSlideId } from './types';

export type FirstGame = { at: Date; source: 'first_played' | 'first_trophy'; game: GameItem | null };

export type WrappedAllInput = {
  /** Ответ Статистики за всё время: единственный источник чисел (расхождений между экранами быть не может). */
  stats: StatsResponse & { period: AllPeriod };
  games: readonly AllGameRow[];
  gameById: ReadonlyMap<number, GameItem>;
  years: { year: number; hasData: boolean }[];
  onlineId: string | null;
  avatarUrl: string | null;
  platinums: WrappedPlatinum[];
  firstGame: FirstGame | null;
  patternCells: readonly PatternCell[];
};

/** Год с максимумом часов; ничья: более ранний; нет часов: null. */
export function busiestYear(byYear: readonly { year: number; hours: number; estimatedHours: number }[]): WrappedAllTime['busiestYear'] {
  let best: { year: number; hours: number; estimatedHours: number } | null = null;
  for (const y of byYear) if (y.hours > 0 && (best === null || y.hours > best.hours)) best = y;
  return best ? { hasData: true, year: best.year, hours: best.hours, estimated: best.estimatedHours > 0 } : { hasData: false, year: null, hours: 0, estimated: false };
}

export function composeWrappedAll(i: WrappedAllInput): WrappedResponse {
  const s = i.stats;
  const hoursByYear = s.hours.byYear ?? [];
  const total = s.header.hours;
  const hoursHas = total !== null && total > 0;
  const tr = s.trophies.byYear ?? [];
  const platTotal = s.trophies.counts.platinum;
  const secs = allSeconds(i.games);
  const top = hoursHas ? topGamesBySeconds(secs, i.gameById, new Map()) : [];
  const leader = top[0] ?? null;
  const finHas = s.header.completed + s.header.dropped > 0;
  const trophiesHas = s.trophies.counts.total > 0;
  const genre = s.genres.items[0] ?? null;
  const pattern = buildPlayPattern(i.patternCells);
  const busiest = busiestYear(hoursByYear);
  const first = i.firstGame;
  const empty = !hoursHas && !trophiesHas && !finHas;

  const allTime: WrappedAllTime = {
    firstGame: first ? { hasData: true, at: first.at.toISOString(), source: first.source, game: first.game } : { hasData: false, at: null, source: null, game: null },
    hoursByYear: { hasData: hoursHas, total, unattributed: s.hours.unattributed ?? 0, byYear: hoursByYear },
    platinumByYear: { hasData: platTotal > 0, total: platTotal, items: tr.map((y) => ({ year: y.year, count: y.platinum })) },
    busiestYear: busiest,
    topGenre: genre ? { hasData: true, key: genre.key, label: genre.label, value: genre.value } : { hasData: false, key: null, label: null, value: 0 },
  };

  const slides: WrappedSlideId[] = empty
    ? ['empty']
    : [
        'start',
        ...(allTime.firstGame.hasData ? (['firstGame'] as const) : []),
        ...(hoursHas ? (['hours'] as const) : []),
        ...(allTime.platinumByYear.hasData ? (['platinumYears'] as const) : []),
        ...(busiest.hasData ? (['busiestYear'] as const) : []),
        ...(allTime.topGenre.hasData ? (['genres'] as const) : []),
        ...(leader ? (['longestGame'] as const) : []),
        ...(pattern.hasData ? (['playPattern'] as const) : []),
        'final',
      ];

  const rare: RareTrophy[] = empty ? [] : s.rareTrophies.allTime;
  return {
    year: s.period.year,
    scope: 'all',
    allTimeAvailable: !empty,
    allTime,
    playPattern: pattern,
    mode: empty ? 'empty' : 'story',
    period: { from: s.period.from, to: s.period.to, fromUtc: s.period.fromUtc, toUtc: s.period.toUtc },
    years: i.years,
    profile: { onlineId: i.onlineId, avatarUrl: i.avatarUrl },
    firstSnapshotDate: s.hours.firstSnapshotDate,
    periodPartial: s.hours.periodPartial,
    slides,
    hours: {
      hasData: hoursHas,
      total,
      days: total === null ? null : Math.round(total / 2.4) / 10,
      byMonth: s.hours.byMonth,
      estimatedByMonth: s.hours.estimatedByMonth,
      estimatedHours: s.hours.estimatedHours,
      hasEstimate: s.hours.hasEstimate,
      topMonth: null,
    },
    topGames: { hasData: top.length > 0, items: top },
    finished: {
      hasData: finHas,
      completed: { count: s.header.completed, items: [] },
      dropped: { count: s.header.dropped, items: [] },
      busiestMonth: null,
    },
    trophies: { hasData: trophiesHas, counts: s.trophies.counts, platinum: pickPlatinums(i.platinums), rare },
    genres: { hasData: s.genres.items.length > 0, items: s.genres.items.slice(0, 3).map(({ key, label, value }) => ({ key, label, value })) },
    longestGame: leader
      ? { hasData: true, seconds: leader.seconds, hours: leader.hours, estimated: false, playCount: leader.game.playCount, game: leader.game }
      : { hasData: false, seconds: 0, hours: 0, estimated: false, playCount: 0, game: null },
    emptyState: empty ? { syncStartedOn: s.hours.firstSnapshotDate } : null,
  };
}
