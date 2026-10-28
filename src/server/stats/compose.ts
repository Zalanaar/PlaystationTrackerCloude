// Сборка ответа /api/stats из сырых данных. Без БД и без текущего времени (today передаётся).
import type { GameItem } from '@/server/collection/types';
import type { MonthExclusions } from './exclusions';
import { aggregateGenresWithGames, type GenreGame, type GenreGameInfo } from './genre-stats';
import { groupFinished, type FinishedEvent } from './finished';
import { calcHours, groupSnapshots, type EstimateInput, type HoursCalc, type Snapshot } from './hours';
import { groupPlayed } from './played';
import type { RareTrophy, StatsPeriod, StatsResponse, StatsTop } from './types';
import { rankByHours, rankByTrophies, type GameTrophyCount } from './top';
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
  /** Карточки игр: завершённые и сыгранные в периоде (played). */
  gameById: ReadonlyMap<number, GameItem>;
  /** Все видимые игры с жанрами и данными карточки жанра (название, обложка). */
  genreGames: ReadonlyMap<number, GenreGame & { title: string; coverUrl: string | null }>;
  /** Трофеи, полученные в периоде, по (игра, тип): игра сета = минимальный id видимой игры; сироты не входят (13.2). */
  trophiesByGame: readonly GameTrophyCount[];
  /** Уже посчитанные часы (query.ts считает их раньше, чтобы собрать id карточек); иначе считаются здесь. */
  hours?: HoursCalc;
  /** 14.1: уже отобранные редкие трофеи (SQL с LIMIT 5); нет = пустые списки. */
  rareTrophies?: { period: RareTrophy[]; allTime: RareTrophy[] };
  /** 15.1: игры, убранные из месяцев (estimates уже содержат excludedMonths). */
  exclusions?: MonthExclusions;
};

export function composeStats(i: StatsInput): StatsResponse {
  const { period } = i;
  const by = groupSnapshots(i.snapshots);
  const h = i.hours ?? calcHours({ by, estimates: i.estimates, period, year: period.year, firstSnapshotDate: i.firstSnapshotDate, today: i.today });

  const { counts, byMonth } = aggregateTrophies(i.trophies, new Date(period.fromUtc), new Date(period.toUtc), period.year);

  const groups = groupFinished(i.finishedEvents, i.gameById);
  const shown = groups.flatMap((g) => g.items);

  const genreIds = new Set<number>(h.seconds.keys());
  for (const e of i.finishedEvents) genreIds.add(e.gameId);
  const genreList: GenreGameInfo[] = [];
  for (const id of genreIds) {
    const g = i.genreGames.get(id);
    if (g) genreList.push({ ...g, id, seconds: h.seconds.get(id) ?? 0 });
  }

  const titles = new Map<number, string>();
  for (const [id, g] of i.genreGames) titles.set(id, g.title);
  const top: StatsTop = {
    byHours: rankByHours(h.seconds, h.estimatedSeconds, titles).flatMap((r) => {
      const game = i.gameById.get(r.gameId);
      return game ? [{ game, hours: r.hours, estimated: r.estimated }] : [];
    }),
    byTrophies: rankByTrophies(i.trophiesByGame, titles).flatMap((r) => {
      const game = i.gameById.get(r.gameId);
      return game ? [{ game, points: r.points, counts: r.counts }] : [];
    }),
  };

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
    genres: aggregateGenresWithGames(genreList),
    top,
    rareTrophies: i.rareTrophies ?? { period: [], allTime: [] },
    trophies: { counts, byMonth },
    finished: { groups },
    played: groupPlayed({ by, estimates: i.estimates, period, finishedEvents: i.finishedEvents, gameById: i.gameById, exclusions: i.exclusions }),
  };
}
