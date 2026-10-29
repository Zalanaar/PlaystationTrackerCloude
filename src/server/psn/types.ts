// Доменные типы PSN для остального кода. Типы psn-api за пределы src/server/psn/ не выходят.

export const GAME_CATEGORIES = ['ps4_game', 'ps5_native_game', 'pspc_game'] as const;
export type GameCategory = (typeof GAME_CATEGORIES)[number];

export type TrophyCounts = { bronze: number; silver: number; gold: number; platinum: number };
export type TrophyKind = 'bronze' | 'silver' | 'gold' | 'platinum';

export type PsnGame = {
  titleId: string;
  conceptId: string | null;
  name: string;
  category: GameCategory;
  imageUrl: string | null;
  /** горизонтальный арт из concept.media.images (правило: mapping.ts pickBanner) */
  bannerUrl: string | null;
  genres: string[];
  playDurationSeconds: number;
  playCount: number;
  firstPlayedAt: Date | null;
  lastPlayedAt: Date | null;
};

export type PsnTrophySet = {
  npCommunicationId: string;
  npServiceName: 'trophy' | 'trophy2';
  name: string;
  platform: string | null;
  iconUrl: string | null;
  defined: TrophyCounts;
  earned: TrophyCounts;
  progress: number;
  lastUpdatedAt: Date | null;
};

export type TrophySetRef = Pick<PsnTrophySet, 'npCommunicationId' | 'npServiceName'>;

export type PsnTrophyEarned = {
  trophyId: number;
  /** В списке полученных трофеев psn-api поля нет (UserThinTrophy): обычно null; группа приходит из определений. */
  groupId: string | null;
  type: TrophyKind;
  hidden: boolean;
  earned: boolean;
  earnedAt: Date | null;
  rarity: number | null;
  earnedRate: string | null;
};

export type PsnTrophyDef = {
  trophyId: number;
  /** trophyGroupId: `default` база, `001`... DLC (контракт 15.3); null, если PSN не отдал. */
  groupId: string | null;
  type: TrophyKind;
  hidden: boolean;
  name: string | null;
  detail: string | null;
  iconUrl: string | null;
};

/** Профиль аккаунта (контракт 12.1). Любое поле, которого PSN не дал, null. */
export type PsnProfile = {
  onlineId: string;
  /** самый крупный из avatarUrls */
  avatarUrl: string | null;
  /** Безопасная диагностика, почему аватара нет (только если avatarUrl = null): без токенов и полных URL. */
  avatarDiag?: string;
  trophyLevel: number | null;
  /** 0..100 до следующего уровня */
  trophyProgress: number | null;
  trophyTier: number | null;
  earned: { platinum: number; gold: number; silver: number; bronze: number } | null;
};

export type PlayedGamesResult = {
  games: PsnGame[];
  /** сколько тайтлов отброшено фильтром category (не игры) */
  skipped: number;
};

/** Единственный интерфейс PSN для синка. Реализация: client.ts; в тестах подменяется. */
export interface PsnClient {
  /** Профиль, полученный при подключении (getProfileFromUserName). null, если разобрать не удалось. */
  readonly profile: PsnProfile | null;
  getPlayedGames(): Promise<PlayedGamesResult>;
  getTrophySets(): Promise<PsnTrophySet[]>;
  /** Трофейные сеты по titleId (до 5 за вызов). Ключ карты = titleId; нет ключа или пусто = сета нет. */
  findTrophySets(titleIds: string[]): Promise<Map<string, PsnTrophySet[]>>;
  getEarnedTrophies(set: TrophySetRef): Promise<PsnTrophyEarned[]>;
  getTrophyDefinitions(set: TrophySetRef): Promise<PsnTrophyDef[]>;
}
