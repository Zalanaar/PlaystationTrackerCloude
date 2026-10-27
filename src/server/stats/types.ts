// Типы ответа GET /api/stats (раздел 10 docs/api-contract.md). Только типы.
import type { GameItem } from '@/server/collection/types';

export type StatsPeriodType = 'year' | 'month';

export type StatsPeriod = {
  type: StatsPeriodType;
  year: number;
  month: number | null;
  /** Даты МСК, включительно. */
  from: string;
  to: string;
  /** ISO UTC; toUtc исключается. */
  fromUtc: string;
  toUtc: string;
};

export type TrophyCountsByType = { platinum: number; gold: number; silver: number; bronze: number; total: number };

export type FinishedItem = { kind: 'completed' | 'dropped'; at: string; game: GameItem };
export type FinishedGroup = { month: string; year: number; monthNumber: number; items: FinishedItem[] };

export type StatsGenreItem = { key: string; label: string; value: number };

export type StatsResponse = {
  period: StatsPeriod;
  years: number[];
  header: { completed: number; dropped: number; hours: number | null; platinum: number };
  hours: {
    /** Полные часы месяца (реальные + оценка) или null. */
    byMonth: (number | null)[];
    /** Оценочная часть byMonth, 12 чисел (0 = оценки нет). */
    estimatedByMonth: number[];
    /** Оценочная часть header.hours за период. */
    estimatedHours: number;
    hasEstimate: boolean;
    firstSnapshotDate: string | null;
    periodPartial: boolean;
  };
  genres: { hasData: boolean; items: StatsGenreItem[] };
  trophies: { counts: TrophyCountsByType; byMonth: (TrophyCountsByType & { month: number })[] };
  finished: { groups: FinishedGroup[] };
};
