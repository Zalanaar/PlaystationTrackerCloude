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

/** Трофейный набор игры: суммы по всем привязанным наборам. */
export type TrophyInfo = { earned: number; total: number; dlcTail: boolean };

export type Candidate = {
  id: number;
  name: string;
  imageUrl: string | null;
  bannerUrl: string | null;
  genres: readonly GenreKey[];
  hours: number | null;
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
    hours: number | null;
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
};

export type ScoreResult = { items: ScoredItem[]; candidates: number };

export type LlmMeta = 'ok' | 'disabled' | 'limit' | 'error';
export type ReasonSource = 'llm' | 'template';
export type Reason = { text: string; source: ReasonSource };

export type RecommendItem = Omit<ScoredItem, 'topGenre'> & { reason: Reason };

export type RecommendResponse = {
  items: RecommendItem[];
  meta: { llm: LlmMeta; candidates: number; time: TimeWish };
};
