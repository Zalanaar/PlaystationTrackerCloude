// Типы ответа GET /api/stats (раздел 10 docs/api-contract.md). Только типы.
import type { GameItem } from '@/server/collection/types';

export type StatsPeriodType = 'year' | 'month' | 'all';
export type BoundedPeriodType = 'year' | 'month';

/** Период с границами (год или месяц). */
export type BoundedPeriod = {
  type: BoundedPeriodType;
  year: number;
  month: number | null;
  /** Даты МСК, включительно. */
  from: string;
  to: string;
  /** ISO UTC; toUtc исключается. */
  fromUtc: string;
  toUtc: string;
};

/** Период «всё время» (26.1): границы = первая/последняя даты данных, null, если данных нет. year = текущий год МСК. */
export type AllPeriod = {
  type: 'all';
  year: number;
  month: null;
  from: string | null;
  to: string | null;
  fromUtc: string | null;
  toUtc: string | null;
};

export type StatsPeriod = BoundedPeriod | AllPeriod;

/** «Когда ты играешь» (26.3): трофеи по часам суток (24) и дням недели (пн..вс) по МСК. */
export type PlayPattern = {
  byHour: number[];
  byWeekday: number[];
  total: number;
  peakHour: number | null;
  peakWeekday: number | null;
  label: string;
  hasData: boolean;
};

/** Часы года при period=all (26.1), десятые доли часа. */
export type HoursYear = { year: number; hours: number; estimatedHours: number; measuredHours: number };

export type TrophyCountsByType = { platinum: number; gold: number; silver: number; bronze: number; total: number };

export type FinishedItem = { kind: 'completed' | 'dropped'; at: string; game: GameItem };
export type FinishedGroup = { month: string; year: number; monthNumber: number; items: FinishedItem[] };

/** Игра в блоке «Игры месяца» (контракт 10.1, Фаза 8). */
export type PlayedItem = {
  /** Ключ в `played.games` (этап 3, BUG-P8-3). */
  gameId: number;
  /** Часы игры за этот месяц (реальные + оценка), до 0.1. 0, если попала только по завершению. */
  hours: number;
  /** Измеренная часть hours (по снимкам), до 0.1 (15.1). hoursReal > 0 = у игры в месяце есть измеренные часы. Необязательно в типе (фикстуры UI). */
  hoursReal?: number;
  /** Оценочная часть hours (1.6), до 0.1 (15.1). */
  hoursEstimated?: number;
  /** В часах месяца есть оценочная доля (1.6). */
  estimated: boolean;
  /** Завершена/брошена именно в этом месяце, иначе null. */
  finished: 'completed' | 'dropped' | null;
  /** ISO UTC completed_at/dropped_at; null вместе с finished. */
  finishedAt: string | null;
};
/** `played` ответа /api/stats: карточки один раз в словаре, группы ссылаются по gameId. */
export type PlayedBlock = { games: Record<string, GameItem>; groups: PlayedGroup[] };
export type PlayedGroup = {
  /** YYYY-MM (МСК). */
  month: string;
  year: number;
  monthNumber: number;
  completed: number;
  dropped: number;
  items: PlayedItem[];
  /**
   * Игры, убранные из этого месяца (15.1); не входят в items и счётчики. hours = только реальные часы месяца.
   * Необязательно в типе (фикстуры src/ui), сервер присылает всегда.
   */
  excluded?: PlayedItem[];
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
    /** 26.1, только при period=all: часы по годам по возрастанию, без пропусков. */
    byYear?: HoursYear[];
    /** 26.1, только при period=all: header.hours - sum(byYear.hours), десятые. */
    unattributed?: number;
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
  trophies: {
    counts: TrophyCountsByType;
    byMonth: (TrophyCountsByType & { month: number })[];
    /** 26.1, только при period=all. */
    byYear?: (TrophyCountsByType & { year: number })[];
  };
  /** Устарело для экрана Статистики с Фазы 8 (используйте played); сохраняется для совместимости. */
  finished: {
    groups: FinishedGroup[];
    /** 26.1, только при period=all. */
    byYear?: { year: number; completed: number; dropped: number }[];
  };
  /** «Игры месяца»: игра в каждом месяце, где в неё играли или её завершили/бросили. */
  played: PlayedBlock;
  /** 26.3: сервер присылает всегда (необязательно в типе из-за фикстур src/ui). */
  playPattern?: PlayPattern;
};
