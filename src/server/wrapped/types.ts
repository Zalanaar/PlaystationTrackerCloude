// Типы ответа GET /api/wrapped (раздел 11 docs/api-contract.md). Только типы.
import type { GameItem } from '@/server/collection/types';
import type { HoursYear, PlayPattern, RareTrophy, StatsGenreItem, TrophyCountsByType } from '@/server/stats/types';

export type WrappedSlideId =
  | 'start'
  | 'hours'
  | 'topGames'
  | 'finished'
  | 'trophies'
  | 'genres'
  | 'longestGame'
  | 'final'
  | 'empty'
  // Фаза 26: «когда ты играешь» (год и всё время) и слайды набора «Всё время»
  | 'playPattern'
  | 'firstGame'
  | 'platinumYears'
  | 'busiestYear'
  // Пакет 3: «Лучшая игра года» по моей оценке (F1)
  | 'bestGame';

/** Набор «за всё время» (26.2), только при scope = 'all'. */
export type WrappedAllTime = {
  firstGame: { hasData: boolean; at: string | null; source: 'first_played' | 'first_trophy' | null; game: GameItem | null };
  hoursByYear: { hasData: boolean; total: number | null; unattributed: number; byYear: HoursYear[] };
  platinumByYear: { hasData: boolean; total: number; items: { year: number; count: number }[] };
  busiestYear: { hasData: boolean; year: number | null; hours: number; estimated: boolean };
  topGenre: { hasData: boolean; key: string | null; label: string | null; value: number };
};

export type WrappedTopGame = { rank: number; seconds: number; hours: number; /** В часах есть оценочная часть (1.6). */ estimated: boolean; game: GameItem };
export type WrappedFinishedItem = { at: string; game: GameItem };
export type WrappedPlatinum = {
  at: string;
  name: string | null;
  earnedRate: number | null;
  rarity: number | null;
  setName: string;
  game: GameItem | null;
};

export type WrappedResponse = {
  /** При scope = 'all' текущий год МСК (смысла не несёт). */
  year: number;
  mode: 'story' | 'empty';
  /** 26.2: 'year' (по умолчанию) или 'all'. Необязательно в типе (фикстуры src/ui), сервер присылает всегда. */
  scope?: 'year' | 'all';
  /** 26.2: есть ли данные для набора «Всё время» (кнопка в выборе года). */
  allTimeAvailable?: boolean;
  /** 26.2: набор «за всё время» или null при scope = 'year'. */
  allTime?: WrappedAllTime | null;
  /** 26.3: «Когда ты играешь» для года или всего времени. */
  playPattern?: PlayPattern;
  /** При scope = 'all' границы = первая/последняя даты данных, могут быть null. */
  period: { from: string | null; to: string | null; fromUtc: string | null; toUtc: string | null };
  years: { year: number; hasData: boolean }[];
  profile: { onlineId: string | null; avatarUrl: string | null };
  firstSnapshotDate: string | null;
  periodPartial: boolean;
  slides: WrappedSlideId[];
  hours: {
    hasData: boolean;
    total: number | null;
    days: number | null;
    byMonth: (number | null)[];
    estimatedByMonth: number[];
    estimatedHours: number;
    hasEstimate: boolean;
    topMonth: { month: number; hours: number } | null;
  };
  topGames: { hasData: boolean; items: WrappedTopGame[] };
  finished: {
    hasData: boolean;
    completed: { count: number; items: WrappedFinishedItem[] };
    dropped: { count: number; items: WrappedFinishedItem[] };
    busiestMonth: { month: number; count: number } | null;
  };
  trophies: {
    hasData: boolean;
    counts: TrophyCountsByType;
    platinum: { first: WrappedPlatinum | null; last: WrappedPlatinum | null; rarest: WrappedPlatinum | null };
    /** 14.1: топ-5 самых редких трофеев года; slides не меняются. */
    rare: RareTrophy[];
  };
  genres: { hasData: boolean; items: StatsGenreItem[] };
  longestGame: { hasData: boolean; seconds: number; hours: number; estimated: boolean; playCount: number; game: GameItem | null };
  emptyState: { syncStartedOn: string | null } | null;
  /** Пакет 3: игра года с наивысшей моей оценкой (среди игранных в году или пройденных в году). Нет в старых ответах и при scope = 'all'. */
  bestGame?: WrappedBestGame;
};

export type WrappedBestGame = { hasData: boolean; rating: number | null; hours: number; estimated: boolean; game: GameItem | null };
