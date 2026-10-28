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

/** Игра в блоке «Игры месяца» (контракт 10.1, Фаза 8). */
export type PlayedItem = {
  game: GameItem;
  /** Часы игры за этот месяц (реальные + оценка), до 0.1. 0, если попала только по завершению. */
  hours: number;
  /** В часах месяца есть оценочная доля (1.6). */
  estimated: boolean;
  /** Завершена/брошена именно в этом месяце, иначе null. */
  finished: 'completed' | 'dropped' | null;
  /** ISO UTC completed_at/dropped_at; null вместе с finished. */
  finishedAt: string | null;
};
export type PlayedGroup = {
  /** YYYY-MM (МСК). */
  month: string;
  year: number;
  monthNumber: number;
  completed: number;
  dropped: number;
  items: PlayedItem[];
};

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
  /** Устарело для экрана Статистики с Фазы 8 (используйте played); сохраняется для совместимости. */
  finished: { groups: FinishedGroup[] };
  /** «Игры месяца»: игра в каждом месяце, где в неё играли или её завершили/бросили. */
  played: { groups: PlayedGroup[] };
};
