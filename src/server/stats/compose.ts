// Сборка ответа /api/stats из сырых данных. Без БД и без текущего времени (today передаётся).
import type { GameItem } from '@/server/collection/types';
import { aggregateGenres, type GenreGame } from './genre-stats';
import { groupFinished, type FinishedEvent } from './finished';
import { calcHours, groupSnapshots, type EstimateInput, type Snapshot } from './hours';
import type { StatsPeriod, StatsResponse } from './types';
import { aggregateTrophies, type EarnedTrophy } from './trophies';

export type StatsInput = {
  period: StatsPeriod;
  /** Сегодняшняя дата МСК, YYYY-MM-DD. */
  today: string;
  years: number[];
  /** Снимки: все внутри года + последний до начала года по каждой игре. */
  snapshots: Snapshot[];
  /** Первые снимки игр + даты запусков для оценки (контракт 1.6). */
  estimates: EstimateInput[];
  /** min(snapshot_date) по всей БД. */
  firstSnapshotDate: string | null;
  /** Трофеи с earned_at в пределах года. */
  trophies: EarnedTrophy[];
  /** Пройдено/брошено, уже отфильтровано по периоду. */
  finishedEvents: FinishedEvent[];
  gameById: ReadonlyMap<number, GameItem>;
  genreGames: ReadonlyMap<number, GenreGame>;
};

export function composeStats(i: StatsInput): StatsResponse {
  const { period } = i;
  const by = groupSnapshots(i.snapshots);
  const h = calcHours({ by, estimates: i.estimates, period, year: period.year, firstSnapshotDate: i.firstSnapshotDate, today: i.today });

  const { counts, byMonth } = aggregateTrophies(i.trophies, new Date(period.fromUtc), new Date(period.toUtc), period.year);

  const groups = groupFinished(i.finishedEvents, i.gameById);
  const shown = groups.flatMap((g) => g.items);

  const genreIds = new Set<number>(h.seconds.keys());
  for (const e of i.finishedEvents) genreIds.add(e.gameId);
  const genreList: GenreGame[] = [];
  for (const id of genreIds) {
    const g = i.genreGames.get(id);
    if (g) genreList.push(g);
  }

  return {
    period,
    years: i.years,
    header: {
      completed: shown.filter((x) => x.kind === 'completed').length,
      dropped: shown.filter((x) => x.kind === 'dropped').length,
      hours: h.totalHours,
      platinum: counts.platinum,
    },
    hours: {
      byMonth: h.byMonth,
      estimatedByMonth: h.estimatedByMonth,
      estimatedHours: h.estimatedHours,
      hasEstimate: h.hasEstimate,
      firstSnapshotDate: i.firstSnapshotDate,
      periodPartial: i.firstSnapshotDate === null || period.from < i.firstSnapshotDate,
    },
    genres: aggregateGenres(genreList),
    trophies: { counts, byMonth },
    finished: { groups },
  };
}
