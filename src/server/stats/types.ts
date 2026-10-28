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

/** Игра в словаре `genres.games` (13.1). */
export type StatsGenreGame = { id: number; title: string; coverUrl: string | null };
/** Жанр в ответе /api/stats (13.1): вес + игры, давшие вес. */
export type StatsGenreEntry = StatsGenreItem & { gameIds: number[] };

/** Топ игр периода (13.2). */
export type TopHoursItem = { game: GameItem; hours: number; /** Есть оценочная доля (1.6). */ estimated: boolean };
export type TopTrophyItem = { game: GameItem; /** Очки: bronze 15, silver 30, gold 90, platinum 300. */ points: number; counts: TrophyCountsByType };
export type StatsTop = { byHours: TopHoursItem[]; byTrophies: TopTrophyItem[] };

/** «Редкий трофей» (14.1): полученный трофей с процентом получивших. Карточка игры короткая. */
export type RareTrophy = {
  setId: number;
  trophyId: number;
  type: 'platinum' | 'gold' | 'silver' | 'bronze';
  name: string | null;
  detail: string | null;
  iconUrl: string | null;
  /** ISO UTC или null (PSN не отдал дату; только в списке «за всё время»). */
  earnedAt: string | null;
  /** % игроков, 2 знака. */
  earnedRate: number;
  /** 0..3 или null. */
  rarity: number | null;
  setName: string;
  /** Видимая игра сета с минимальным id или null (сет-сирота). */
  game: StatsGenreGame | null;
};

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
  genres: {
    hasData: boolean;
    items: StatsGenreEntry[];
    /** Все игры из `items[].gameIds`, ключ = строка id (13.1). */
    games: Record<string, StatsGenreGame>;
  };
  top: StatsTop;
  /** 14.1: топ-5 самых редких полученных трофеев за период и за всё время. */
  rareTrophies: { period: RareTrophy[]; allTime: RareTrophy[] };
  trophies: { counts: TrophyCountsByType; byMonth: (TrophyCountsByType & { month: number })[] };
  /** Устарело для экрана Статистики с Фазы 8 (используйте played); сохраняется для совместимости. */
  finished: { groups: FinishedGroup[] };
  /** «Игры месяца»: игра в каждом месяце, где в неё играли или её завершили/бросили. */
  played: { groups: PlayedGroup[] };
};
