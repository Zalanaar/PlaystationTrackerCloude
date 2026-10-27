// Типы ответов раздела 9 docs/api-contract.md. Только типы: frontend импортирует через `import type`.
export type GameStatusValue = 'playing' | 'completed' | 'dropped' | 'backlog' | 'shelved';
export type StatusFilterValue = GameStatusValue | 'none';
export type Platform = 'PS4' | 'PS5' | 'PC';
export type GameSort = 'last_played' | 'hours' | 'title' | 'trophies_progress' | 'completed_at';
export type SortOrder = 'asc' | 'desc';

export type TrophyCounts = { earned: number; defined: number };

export type GameTrophies = {
  earned: number;
  defined: number;
  /** 0..100 */
  progress: number;
  platinumDefined: boolean;
  platinumEarned: boolean;
  byType: { platinum: TrophyCounts; gold: TrophyCounts; silver: TrophyCounts; bronze: TrophyCounts };
};

export type GameGenre = { key: string; label: string };

export type GameItem = {
  id: number;
  title: string;
  coverUrl: string | null;
  platform: Platform;
  playSeconds: number;
  hours: number;
  playCount: number;
  lastPlayedAt: string | null;
  status: GameStatusValue | null;
  completedAt: string | null;
  droppedAt: string | null;
  trophies: GameTrophies | null;
  genres: GameGenre[];
};

export type StatusCounts = { all: number; playing: number; completed: number; dropped: number; backlog: number; shelved: number; none: number };

export type GamesListResponse = {
  items: GameItem[];
  total: number;
  limit: number;
  offset: number;
  counts: StatusCounts;
  years: number[];
};

export type CollectionSummaryResponse = {
  totals: { games: number; playSeconds: number; hours: number; trophiesEarned: number; platinumEarned: number };
  counts: StatusCounts;
  playing: GameItem[];
  continue: GameItem[];
};

export type GameMutationResponse = { game: GameItem };
export type BulkStatusResponse = { requested: number; changed: number; games: GameItem[] };
