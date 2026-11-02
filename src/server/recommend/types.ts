// Типы «Подскажи» (контракт 18). Без env/БД/сети: используются и чистым скорингом.
import type { GenreKey } from '@/shared/genres';

export const TIME_WISHES = ['any', 'short', 'medium', 'long'] as const;
export type TimeWish = (typeof TIME_WISHES)[number];

export type SignalKey = 'genre_affinity' | 'duration_fit' | 'platinum_close' | 'waiting' | 'dropped_genre_penalty';

/** Игра истории (completed / playing / dropped) для вкуса по жанрам. */
export type HistoryGame = {
  id: number;
  status: 'playing' | 'completed' | 'dropped';
  genres: readonly GenreKey[];
  playSeconds: number;
};

/** Трофейный набор игры: суммы по привязанным наборам без трофеев DLC (Фаза 36). dlcTail оставлен для совместимости, db.ts всегда false. */
export type TrophyInfo = { earned: number; total: number; dlcTail: boolean };

export type Candidate = {
  id: number;
  name: string;
  imageUrl: string | null;
  bannerUrl: string | null;
  genres: readonly GenreKey[];
  /** ОСТАТОК часов (18.3, Фаза 32): max(база − наиграно, 15% базы). Его видит duration_fit. */
  hours: number | null;
  /** Полная база (override/HLTB). */
  totalHours?: number | null;
  hoursSource: 'manual' | 'hltb' | null;
  /** game_status.status_changed_at: когда игра попала в бэклог. */
  statusChangedAt: Date;
  trophy: TrophyInfo | null;
};

export type Signal = { key: SignalKey; label: string; contribution: number };

export type ScoredItem = {
  game: {
    id: number;
    name: string;
    imageUrl: string | null;
    bannerUrl: string | null;
    genres: GenreKey[];
    /** Остаток часов (18.3). */
    hours: number | null;
    totalHours?: number | null;
    hoursSource: 'manual' | 'hltb' | null;
  };
  score: number;
  signals: Signal[];
  /** Жанр с наибольшим вкладом в genre_affinity (для шаблонной причины); null, если сигнала нет. */
  topGenre: GenreKey | null;
};

export type ScoreInput = {
  candidates: readonly Candidate[];
  history: readonly HistoryGame[];
  dislikedIds: ReadonlySet<number>;
  time: TimeWish;
  /** «Сейчас» передаётся аргументом: внутри Date.now не используется. */
  now: Date;
  /** Сколько лучших вернуть (по умолчанию TOP_N). Шаг синка (20.5) просит весь бэклог. */
  limit?: number;
};

export type ScoreResult = { items: ScoredItem[]; candidates: number };

export type LlmMeta = 'ok' | 'disabled' | 'limit' | 'error';
export type ReasonSource = 'llm' | 'template';
export type Reason = { text: string; source: ReasonSource };

export type RecommendItem = Omit<ScoredItem, 'topGenre'> & { reason: Reason };

export type RecommendResponse = {
  items: RecommendItem[];
  /** llmPending: карточек с шаблоном при включённом LLM (фразу создаст ночной синк, контракт 20.4). */
  meta: { llm: LlmMeta; candidates: number; time: TimeWish; llmPending: number };
};

/** GET /api/recommend/dislikes (18.9). */
export type DislikeItem = {
  game: { id: number; name: string; imageUrl: string | null; bannerUrl: string | null; genres: GenreKey[] };
  hiddenAt: string;
  expiresAt: string;
};
export type DislikesResponse = { items: DislikeItem[]; ttlDays: number };
