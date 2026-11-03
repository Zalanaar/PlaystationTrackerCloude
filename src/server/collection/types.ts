// Типы ответов раздела 9 docs/api-contract.md. Только типы: frontend импортирует через `import type`.
import type { GameHistory } from './history';
export type { GameHistory, HistoryWeek } from './history';
export type GameStatusValue = 'playing' | 'completed' | 'dropped' | 'backlog' | 'shelved' | 'service';
export type StatusFilterValue = GameStatusValue | 'none';
export type Platform = 'PS4' | 'PS5' | 'PC';
export type GameSort = 'last_played' | 'hours' | 'title' | 'trophies_progress' | 'completed_at' | 'rating';
export type SortOrder = 'asc' | 'desc';
/** Сортировки GET /api/games: GameSort + длительность (16.4). Отдельный тип, чтобы не ломать Record<GameSort, ...> в src/ui. */
export type ListSort = GameSort | 'duration';

export type DurationBucket = 'lt10' | '10_30' | '30_60' | '60plus' | 'unknown';
export type HltbStatus = 'found' | 'not_found' | 'unchecked';
export type HltbCounts = Record<HltbStatus, number>;
export type DurationCounts = Record<DurationBucket, number>;

/** Длительность прохождения (16.3). */
export type GameDuration = {
  /** Эффективные часы: ручные, иначе HLTB main; null = неизвестно. */
  hours: number | null;
  source: 'manual' | 'hltb' | null;
  bucket: DurationBucket;
  /** Фаза 32 (D3, 16.3): остаток max(hours − наиграно, 15% hours), 0.1; null, если hours = null. Сервер присылает всегда; необязательное из-за фикстур src/ui. */
  remainingHours?: number | null;
  /** Доля пройденного 0..1 (0.01) = 1 − remainingHours / hours; null, если hours = null. */
  progress?: number | null;
  overrideHours: number | null;
  hltb: {
    status: HltbStatus;
    id: number | null;
    name: string | null;
    mainHours: number | null;
    extraHours: number | null;
    checkedAt: string | null;
  };
};

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

/** 25.4: версия-дубль главной игры. hours = собственные часы версии. */
export type LinkedVersion = { gameId: number; title: string; platform: Platform; hours: number };

export type GameItem = {
  id: number;
  title: string;
  coverUrl: string | null;
  /** Горизонтальный арт (12.2) или null: UI рисует размытый фон из обложки. */
  bannerUrl: string | null;
  /**
   * Цвет акцента из обложки `#rrggbb` (15.2) или null: UI берёт акцент темы. Сервер присылает всегда;
   * необязательное в типе, чтобы не ломать фикстуры GameItem в src/ui (зона frontend).
   */
  tint?: string | null;
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
  /** 16.3. Сервер присылает всегда; необязательное в типе из-за фикстур src/ui. */
  duration?: GameDuration;
  /** 25.4: версии-дубли (только у главной, иначе []). Сервер присылает всегда; необязательное из-за фикстур src/ui. */
  linkedVersions?: LinkedVersion[];
  /** 25.4: id главной, если эта игра дубль (только в ответах по id дубля), иначе null. */
  duplicateOfGameId?: number | null;
  /** F1 (9.9): личная оценка 0–10; null = не оценена (0 — настоящая оценка). Сервер присылает всегда; необязательное из-за фикстур src/ui. */
  rating?: number | null;
};

/** F1 (9.9): личная оценка и заметка. */
export type GameReview = { rating: number | null; note: string | null; updatedAt: string };

export type StatusCounts = { all: number; playing: number; completed: number; dropped: number; backlog: number; shelved: number; service: number; none: number };

export type GenreCounts = Partial<Record<string, number>>;

export type GamesListResponse = {
  items: GameItem[];
  total: number;
  limit: number;
  offset: number;
  counts: StatusCounts;
  years: number[];
  /** 14.4: число забытых игр во всей коллекции (без учёта фильтров запроса). */
  forgottenCount: number;
  /** 16.4: бакеты длительности в области запроса без фильтра `duration`. */
  durationCounts: DurationCounts;
  /** 16.4: счётчики жанровых чипов (ключи GenreKey и `none`) без фильтра `genres`; только ненулевые ключи. */
  genreCounts: GenreCounts;
  /** 16.4: счётчики статусов HLTB в области запроса без фильтра `hltb`. */
  hltbCounts: HltbCounts;
};

/** 48.1: `GET /api/games/batch` — ответы 9.2 по порядку параметров `b`; упавшая выборка = `{ ok: false }`. */
export type GamesBatchResponse = {
  results: ({ ok: true; data: GamesListResponse } | { ok: false; code: 'db_unavailable' })[];
};

/** Профиль PSN-аккаунта (12.3). Любое поле, которого PSN не дал, null. */
export type PsnProfile = {
  onlineId: string;
  avatarUrl: string | null;
  level: number | null;
  /** 0..100 до следующего уровня */
  levelProgress: number | null;
  tier: number | null;
  /** null, если счётчиков нет */
  trophies: { platinum: number; gold: number; silver: number; bronze: number; total: number } | null;
};

/** Прогноз платины (14.2): сколько осталось неплатиновых трофеев сета с неполученной платиной. */
export type PlatinumForecast = {
  setId: number;
  /** Неплатиновых трофеев базовой группы сета (15.3: DLC отдельно в `dlc`; пока group_id неизвестен, считается как база, см. `approximate`). */
  required: number;
  earned: number;
  /** floor(earned / required * 100), 0..100. */
  progress: number;
  remaining: { gold: number; silver: number; bronze: number; total: number };
  /** Сколько из оставшихся скрытые. */
  remainingHidden: number;
  /** Среднее / минимум earned_rate оставшихся (2 знака) или null. */
  avgEarnedRate: number | null;
  minEarnedRate: number | null;
  /** У скольких оставшихся известен процент. */
  ratesKnown: number;
  platinumEarnedRate: number | null;
  /**
   * 15.3: true, если в сете есть трофеи без group_id (DLC ещё не отделены от базы): прогноз приблизительный.
   * Необязательное в типе (фикстуры src/ui), сервер присылает всегда.
   */
  approximate?: boolean;
  /** 15.3: неплатиновые трофеи DLC того же сета (в required/remaining не входят) или null, если DLC нет. */
  dlc?: { required: number; earned: number; remaining: number } | null;
};

export type NearPlatinumItem = { game: GameItem; forecast: PlatinumForecast };

export type CollectionSummaryResponse = {
  totals: { games: number; playSeconds: number; hours: number; trophiesEarned: number; platinumEarned: number };
  counts: StatusCounts;
  playing: GameItem[];
  /** Игры со статусом `service`, last_played_at desc; всего их `counts.service`. */
  services: GameItem[];
  continue: GameItem[];
  /** null, если синк профиль ещё не сохранял (12.3). */
  profile: PsnProfile | null;
  /** 14.2: до 5 игр, ближе всего к платине (видимые, не dropped). */
  nearPlatinum: NearPlatinumItem[];
};

export type GameMutationResponse = { game: GameItem };
export type BulkStatusResponse = { requested: number; changed: number; games: GameItem[] };
/** POST /api/games/status-reset-all (9.8). backupId = null, если сбрасывать было нечего. */
export type StatusResetAllResponse = { backupId: number | null; reset: number };
/** POST /api/games/status-restore (9.9). backupId = бэкап состояния до отката. */
export type StatusRestoreResponse = { restored: number; skipped: number; backupId: number };
/** GET /api/games/status-backups (9.9a). */
export type StatusBackupsResponse = { latest: { id: number; createdAt: string; reason: 'reset_all'; count: number } | null };
/** Строка payload в status_backups (1.12). Даты ISO UTC. */
export type StatusBackupRow = {
  gameId: number;
  status: GameStatusValue;
  completedAt: string | null;
  droppedAt: string | null;
  statusChangedAt: string;
};

/** Трофей в окне игры (12.5). Скрытый и не полученный: name/detail = null. */
export type GameTrophyItem = {
  setId: number;
  trophyId: number;
  /** 15.3: PSN trophyGroupId (`default` база, `001`... DLC) или null (ещё не загружено). */
  groupId?: string | null;
  type: 'platinum' | 'gold' | 'silver' | 'bronze';
  name: string | null;
  detail: string | null;
  iconUrl: string | null;
  hidden: boolean;
  earned: boolean;
  earnedAt: string | null;
  /** 0..3 (0 ультра-редкий) или null */
  rarity: number | null;
  /** % игроков, 2 знака, или null */
  earnedRate: number | null;
};

/** GET /api/games/{id} (12.5). */
export type GameDetailsResponse = {
  game: GameItem;
  firstPlayedAt: string | null;
  statusChangedAt: string | null;
  trophyList: GameTrophyItem[];
  /** 14.2: null, если платины нет, она получена или трофеи сета не загружены. */
  platinumForecast: PlatinumForecast | null;
  /** 26.1: история по неделям МСК. Необязательное в типе (фикстуры UI); сервер присылает всегда. */
  history?: GameHistory | null;
  /** F1 (9.9): оценка и заметка; null = нет. Необязательное в типе (фикстуры UI); сервер присылает всегда. */
  review?: GameReview | null;
};

/**
 * Первый экран `/` с сервера (item 4): те же тела, что отдали бы GET summaryUrl и GET batchUrl.
 * Клиент кладёт их в кэш GET под этими URL (без повторного запроса) и рисует коллекцию сразу из HTML.
 */
export type CollectionInitial = {
  summaryUrl: string;
  summary: CollectionSummaryResponse;
  batchUrl: string;
  batch: GamesBatchResponse;
  /** время сервера (мс, до минуты): «N ч назад» в HTML и при гидрации совпадают */
  now: number;
  /** полоса «С прошлого визита» (GET /api/inbox): без неё скелет полосы над «Играю» менялся бы на чипы после гидрации (сдвиг). null = клиент грузит сам */
  inbox: import('@/server/inbox/query').InboxResponse | null;
  /** true: игры облегчены (slim.ts) — тела не равны ответам API, в кэш GET их класть нельзя; окно игры берёт полные данные из деталей */
  slim?: true;
  /** P1-2: игра прямой ссылки `/?game=<id>` целиком (не облегчена): шапка окна с баннером уже в HTML. Нет ссылки или игры = нет поля */
  linkGame?: GameItem | null;
};
