// Скоринг бэклога (контракт 18.3). Чистая детерминированная функция: без env, БД, сети и Date.now.
import { GENRE_LABELS_RU, type GenreKey } from '@/shared/genres';
import type { Candidate, HistoryGame, ScoredItem, ScoreInput, ScoreResult, Signal, SignalKey, TimeWish } from './types';

/** Веса сигналов (единственное место). dropped_genre_penalty задан отрицательным: значение сигнала в [0, 1], вклад = вес * значение. */
export const WEIGHTS: Readonly<Record<SignalKey, number>> = {
  genre_affinity: 3,
  duration_fit: 2,
  platinum_close: 1.5,
  waiting: 1,
  dropped_genre_penalty: -2,
};

export const TOP_N = 9;
/** Окна длительности по запросу (часы): short <= 8, medium 8..30, long > 30. */
export const SHORT_MAX_HOURS = 8;
export const MEDIUM_MAX_HOURS = 30;
/** На сколько часов мимо окна значение доходит до -1. */
export const DURATION_MISS_SCALE_HOURS = 20;
export const WAITING_SATURATION_DAYS = 365;
/** Доля hoursNorm и доля пройдено/брошено в genre_affinity. */
export const AFFINITY_HOURS_SHARE = 0.6;
export const AFFINITY_FINISH_SHARE = 0.4;
/** Штраф жанра: dropped > 50% решённых игр при >= 3 решённых. */
export const PENALTY_MIN_GAMES = 3;
export const PENALTY_DROPPED_SHARE = 0.5;

const DAY_MS = 86_400_000;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Убирает шум float, чтобы сравнение и тай-брейк были устойчивы. */
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

export type GenreStat = { hours: number; completed: number; dropped: number; decidedGames: number; droppedGames: number };

/** Статистика жанров библиотеки: игра делится между жанрами по 1/N. */
export function genreStats(history: readonly HistoryGame[]): Map<GenreKey, GenreStat> {
  const stats = new Map<GenreKey, GenreStat>();
  const get = (g: GenreKey): GenreStat => {
    let s = stats.get(g);
    if (!s) stats.set(g, (s = { hours: 0, completed: 0, dropped: 0, decidedGames: 0, droppedGames: 0 }));
    return s;
  };
  for (const h of [...history].sort((a, b) => a.id - b.id)) {
    if (h.genres.length === 0) continue;
    const part = 1 / h.genres.length;
    for (const g of h.genres) {
      const s = get(g);
      if (h.status === 'completed' || h.status === 'playing') s.hours += (h.playSeconds / 3600) * part;
      if (h.status === 'completed') s.completed += part;
      if (h.status === 'dropped') s.dropped += part;
      if (h.status === 'completed' || h.status === 'dropped') s.decidedGames += 1;
      if (h.status === 'dropped') s.droppedGames += 1;
    }
  }
  return stats;
}

/** Значение вкуса по жанру в [-1, 1]; нет истории = 0. */
export function affinityOf(s: GenreStat | undefined, maxHours: number): number {
  if (!s) return 0;
  const finished = s.completed + s.dropped;
  const share = finished > 0 ? (s.completed - s.dropped) / finished : 0;
  const hoursNorm = maxHours > 0 ? s.hours / maxHours : 0;
  return clamp(AFFINITY_HOURS_SHARE * hoursNorm + AFFINITY_FINISH_SHARE * share, -1, 1);
}

export function penalized(s: GenreStat | undefined): boolean {
  return !!s && s.decidedGames >= PENALTY_MIN_GAMES && s.droppedGames / s.decidedGames > PENALTY_DROPPED_SHARE;
}

/** Значение duration_fit в [-1, 1] или null, если часов нет. any = 0. */
export function durationFit(hours: number | null, time: TimeWish): number | null {
  if (time === 'any') return 0;
  if (hours === null || !Number.isFinite(hours) || hours <= 0) return null;
  let miss = 0;
  if (time === 'short') miss = Math.max(0, hours - SHORT_MAX_HOURS);
  else if (time === 'medium') miss = hours < SHORT_MAX_HOURS ? SHORT_MAX_HOURS - hours : Math.max(0, hours - MEDIUM_MAX_HOURS);
  else miss = Math.max(0, MEDIUM_MAX_HOURS - hours);
  return 1 - 2 * Math.min(miss / DURATION_MISS_SCALE_HOURS, 1);
}

/** Доля полученных трофеев у начатой игры; DLC-хвост вдвое снижает; не начата или набора нет = 0. */
export function platinumClose(t: Candidate['trophy']): number {
  if (!t || t.total <= 0 || t.earned <= 0) return 0;
  return clamp(t.earned / t.total, 0, 1) * (t.dlcTail ? 0.5 : 1);
}

export function waitingValue(since: Date, now: Date): number {
  const days = (now.getTime() - since.getTime()) / DAY_MS;
  return clamp(days / WAITING_SATURATION_DAYS, 0, 1);
}

const ruLabel = (g: GenreKey) => GENRE_LABELS_RU[g];
const waitingLabel = (days: number) => (days < 60 ? `В бэклоге ${Math.max(0, Math.floor(days))} дн.` : `В бэклоге ${Math.floor(days / 30)} мес.`);

export function scoreCandidate(c: Candidate, ctx: { stats: Map<GenreKey, GenreStat>; maxHours: number; time: TimeWish; now: Date }): ScoredItem {
  const signals: Signal[] = [];
  const push = (key: SignalKey, value: number, label: string) => signals.push({ key, label, contribution: r6(WEIGHTS[key] * value) });
  const genres = c.genres.length ? c.genres : (['OTHER'] as GenreKey[]);

  // genre_affinity: среднее по жанрам игры (1/N)
  let topGenre: GenreKey | null = null;
  let top = -Infinity;
  let sum = 0;
  for (const g of genres) {
    const a = affinityOf(ctx.stats.get(g), ctx.maxHours);
    sum += a;
    if (a > top) {
      top = a;
      topGenre = g;
    }
  }
  const affinity = sum / genres.length;
  if (affinity !== 0 && topGenre) {
    const s = ctx.stats.get(topGenre);
    const hrs = Math.round(s?.hours ?? 0);
    const finished = (s?.completed ?? 0) + (s?.dropped ?? 0);
    const pct = finished > 0 ? Math.round(((s?.completed ?? 0) / finished) * 100) : null;
    const g = ruLabel(topGenre);
    const label =
      affinity >= 0.2
        ? `Любимый жанр: ${g}, ${hrs} ч${pct !== null ? `, ${pct}% пройдено` : ''}`
        : affinity < 0
          ? `Жанр «${g}» ты чаще бросаешь`
          : `Знакомый жанр: ${g}, ${hrs} ч`;
    push('genre_affinity', affinity, label);
  } else {
    topGenre = null;
  }

  // duration_fit
  const fit = durationFit(c.hours, ctx.time);
  if (fit === null) push('duration_fit', 0, 'Длительность неизвестна');
  else if (fit !== 0) {
    const h = Math.round((c.hours ?? 0) * 10) / 10;
    push('duration_fit', fit, fit > 0 ? `Подходит по времени: около ${h} ч` : `Не по времени: около ${h} ч`);
  }

  // platinum_close
  const pc = platinumClose(c.trophy);
  if (pc > 0 && c.trophy) {
    push('platinum_close', pc, `Трофеи: ${c.trophy.earned} из ${c.trophy.total}${c.trophy.dlcTail ? ', есть DLC-хвост' : ''}`);
  }

  // waiting
  const days = (ctx.now.getTime() - c.statusChangedAt.getTime()) / DAY_MS;
  const w = waitingValue(c.statusChangedAt, ctx.now);
  if (w > 0) push('waiting', w, waitingLabel(days));

  // dropped_genre_penalty: доля жанров игры, которые ты чаще бросаешь
  const bad = genres.filter((g) => penalized(ctx.stats.get(g)));
  if (bad.length) push('dropped_genre_penalty', bad.length / genres.length, `Жанр «${ruLabel(bad[0])}» бросаешь чаще, чем проходишь`);

  const total = r6(signals.reduce((a, s) => a + s.contribution, 0));
  // Нулевые вклады, кроме пометки «длительность неизвестна», не показываем; по убыванию |вклада|, при равенстве по ключу.
  const order = Object.keys(WEIGHTS);
  const shown = signals
    .filter((s) => s.contribution !== 0 || s.key === 'duration_fit')
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution) || order.indexOf(a.key) - order.indexOf(b.key))
    .map((s) => ({ ...s, contribution: r2(s.contribution) }));
  return {
    game: { id: c.id, name: c.name, imageUrl: c.imageUrl, bannerUrl: c.bannerUrl, genres: [...c.genres], hours: c.hours, hoursSource: c.hoursSource },
    score: total,
    signals: shown,
    topGenre,
  };
}

/** Топ бэклога (TOP_N или input.limit). Тай-брейк: game.id asc. Одинаковый вход даёт одинаковый выход. */
export function scoreBacklog(input: ScoreInput): ScoreResult {
  const eligible = [...input.candidates].filter((c) => !input.dislikedIds.has(c.id)).sort((a, b) => a.id - b.id);
  const stats = genreStats(input.history);
  const maxHours = Math.max(0, ...[...stats.values()].map((s) => s.hours));
  const scored = eligible.map((c) => scoreCandidate(c, { stats, maxHours, time: input.time, now: input.now }));
  scored.sort((a, b) => b.score - a.score || a.game.id - b.game.id);
  return { items: scored.slice(0, input.limit ?? TOP_N).map((s) => ({ ...s, score: r2(s.score) })), candidates: eligible.length };
}
