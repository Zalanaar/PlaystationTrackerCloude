// F3 «Лента трофеев» (контракт §24): типы ответа GET /api/trophies/feed. UI импортирует только `import type`.
export type FeedPeriod = '7d' | 'month' | 'all';
export type TrophyType = 'platinum' | 'gold' | 'silver' | 'bronze';

export type FeedItem = {
  /** trophies.id: ключ строки */
  id: number;
  setId: number;
  trophyId: number;
  type: TrophyType;
  name: string | null;
  detail: string | null;
  iconUrl: string | null;
  /** ISO UTC; null = PSN не отдал дату (старые PS3/PS4), только в «Все», в конце */
  earnedAt: string | null;
  /** дата МСК «YYYY-MM-DD» (группа дня); null без даты */
  day: string | null;
  earnedRate: number | null;
  /** PSN 0 ultra rare … 3 common */
  rarity: number | null;
  setName: string;
  /** главная карточка игры сета; null = сирота (сет без видимой игры) */
  game: { id: number; title: string } | null;
};

export type FeedSummary = { total: number; platinum: number; gold: number; silver: number; bronze: number };

export type FeedResponse = {
  period: FeedPeriod;
  rare: boolean;
  /** «сегодня» по МСК на момент ответа: подписи «Сегодня / Вчера» */
  today: string;
  summary: FeedSummary;
  items: FeedItem[];
  /** курсор следующей страницы; null = конец */
  nextCursor: string | null;
};
