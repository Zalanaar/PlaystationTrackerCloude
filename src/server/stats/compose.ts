// Сборка ответа /api/stats из сырых данных. Без БД и без текущего времени (today передаётся).
import type { GameItem } from '@/server/collection/types';
import { aggregateGenres, type GenreGame } from './genre-stats';
import { groupFinished, type FinishedEvent } from './finished';
import { groupSnapshots, hasCoverage, hoursByMonth, secondsByGame, secondsToHours, sumSeconds, type Snapshot } from './hours';
import type { StatsPeriod, StatsResponse } from './types';
import { aggregateTrophies, type EarnedTrophy } from './trophies';

export type StatsInput = {
  period: StatsPeriod;
  /** Сегодняшняя дата МСК, YYYY-MM-DD. */
  today: string;
  years: number[];
  /** Снимки: все внутри года + последний до начала года по каждой игре. */
  snapshots: Snapshot[];
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
  const periodSeconds = secondsByGame(by, period.from, period.to);
  const covered = hasCoverage(i.firstSnapshotDate, period.from, period.to, i.today);

  const { counts, byMonth } = aggregateTrophies(i.trophies, new Date(period.fromUtc), new Date(period.toUtc), period.year);

  const groups = groupFinished(i.finishedEvents, i.gameById);
  const shown = groups.flatMap((g) => g.items);

  const genreIds = new Set<number>(periodSeconds.keys());
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
      hours: covered ? secondsToHours(sumSeconds(periodSeconds)) : null,
      platinum: counts.platinum,
    },
    hours: {
      byMonth: hoursByMonth(by, period.year, i.firstSnapshotDate, i.today),
      firstSnapshotDate: i.firstSnapshotDate,
      periodPartial: i.firstSnapshotDate === null || period.from < i.firstSnapshotDate,
    },
    genres: aggregateGenres(genreList),
    trophies: { counts, byMonth },
    finished: { groups },
  };
}
