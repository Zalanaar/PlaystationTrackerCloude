// Типы ответов раздела 9 docs/api-contract.md. Только типы: frontend импортирует через `import type`.
export type GameStatusValue = 'playing' | 'completed' | 'dropped' | 'backlog' | 'shelved' | 'service';
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
  /**
   * ISO UTC момента скрытия или null (игра видна). Контракт 9.1, 9.7. Сервер присылает поле ВСЕГДА;
   * в типе оно необязательное только чтобы не ломать фикстуры GameItem в тестах src/ui (зона frontend).
   * TODO(frontend): добавить `hiddenAt: null` в фикстуры, затем сделать поле обязательным.
   */
  hiddenAt?: string | null;
};

export type StatusCounts = { all: number; playing: number; completed: number; dropped: number; backlog: number; shelved: number; service: number; none: number };

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
  /** Игры со статусом `service`, last_played_at desc; всего их `counts.service`. */
  services: GameItem[];
  continue: GameItem[];
};

export type GameMutationResponse = { game: GameItem };
export type BulkStatusResponse = { requested: number; changed: number; games: GameItem[] };
/** POST /api/games/status-reset-all (9.8). backupId = null, если сбрасывать было нечего. */
export type StatusResetAllResponse = { backupId: number | null; reset: number };
/** POST /api/games/status-restore (9.9). backupId = бэкап состояния до отката. */
export type StatusRestoreResponse = { restored: number; skipped: number; backupId: number };
/** Строка payload в status_backups (1.12). Даты ISO UTC. */
export type StatusBackupRow = {
  gameId: number;
  status: GameStatusValue;
  completedAt: string | null;
  droppedAt: string | null;
  statusChangedAt: string;
};
