// Типы ответа GET /api/wrapped (раздел 11 docs/api-contract.md). Только типы.
import type { GameItem } from '@/server/collection/types';
import type { StatsGenreItem, TrophyCountsByType } from '@/server/stats/types';

export type WrappedSlideId = 'start' | 'hours' | 'topGames' | 'finished' | 'trophies' | 'genres' | 'longestGame' | 'final' | 'empty';

export type WrappedTopGame = { rank: number; seconds: number; hours: number; game: GameItem };
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
  year: number;
  mode: 'story' | 'empty';
  period: { from: string; to: string; fromUtc: string; toUtc: string };
  years: { year: number; hasData: boolean }[];
  profile: { onlineId: string | null };
  firstSnapshotDate: string | null;
  periodPartial: boolean;
  slides: WrappedSlideId[];
  hours: {
    hasData: boolean;
    total: number | null;
    days: number | null;
    byMonth: (number | null)[];
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
  };
  genres: { hasData: boolean; items: StatsGenreItem[] };
  longestGame: { hasData: boolean; seconds: number; hours: number; playCount: number; game: GameItem | null };
  emptyState: { syncStartedOn: string | null } | null;
};
