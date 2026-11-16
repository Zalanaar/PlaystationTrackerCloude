// П8.2: оформление историй «Итогов» — цвет слайда, мозаика обложек фоном, крупные числа и сводка года для финального слайда
// (та же сводка рисуется в картинке «Поделиться»). Только чистые функции.
import type { GameItem } from '@/server/collection/types';
import type { WrappedResponse } from '@/server/wrapped/types';
import { formatNumber, plural } from '../format';
import { hoursText, slideCover, type StorySlideId } from './model';

/**
 * Цвет слайда (до смешивания с акцентом темы в CSS). Насыщенные средние тона: под затемнением истории (.55) белый текст
 * и приглушённый (.7) держат 4.5 и на белой обложке (look.test). Фигуры статусов и цвета Sony не используются.
 */
export const SLIDE_COLORS: Record<StorySlideId, string> = {
  start: '#6a4cff',
  hours: '#2f7bff',
  topGames: '#ff7a1a',
  finished: '#18b38a',
  trophies: '#b98200',
  rareTrophies: '#13a6b8',
  genres: '#e8458b',
  longestGame: '#e04a3c',
  bestGame: '#c98a12',
  firstGame: '#4f5bd5',
  platinumYears: '#5aa9e6',
  busiestYear: '#1fa2ff',
  playPattern: '#9b4dff',
  final: '#6a4cff',
  empty: '#5c6380',
};
export const slideColor = (id: StorySlideId): string => SLIDE_COLORS[id] ?? SLIDE_COLORS.empty;

/** Затемнение истории и непрозрачность арта: потолки контраста (look.test), не повышать без пересчёта. */
export const STORY_SHADE = 0.55;
export const ART_OPACITY = 0.7;
export const TINT_ALPHA = 0.55;

/** Обложки для фона слайда без своей игры: до 4 разных из топа, пройденных и самой долгой. */
export function slideMosaic(id: StorySlideId, d: WrappedResponse): string[] {
  if (slideCover(id, d)?.url) return [];
  const games: (GameItem | null | undefined)[] = [
    ...d.topGames.items.map((x) => x.game),
    ...d.finished.completed.items.map((x) => x.game),
    d.longestGame.game,
    d.bestGame?.game,
  ];
  const out: string[] = [];
  for (const g of games) {
    const u = g?.coverUrl;
    if (u && !out.includes(u)) out.push(u);
    if (out.length === 4) break;
  }
  return out;
}

/** Размер крупного числа по длине строки: короткое крупнее, длинное («2 840,5») помещается в ширину сцены. В cqw сцены. */
export function bigNumberCqw(text: string): number {
  const n = text.replace(/\s/g, '').length;
  return n <= 2 ? 34 : n <= 3 ? 30 : n <= 4 ? 25 : n <= 5 ? 21 : 17;
}

export type SummaryGame = { id: number; title: string; coverUrl: string | null; hours: number | null; estimated: boolean };
export type YearSummary = {
  scope: 'year' | 'all';
  year: number;
  hours: number | null;
  hoursEstimated: boolean;
  completed: number;
  platinums: number;
  trophies: number;
  top3: SummaryGame[];
  /** «Игра года»: лучшая по моей оценке, иначе первая по часам. */
  gameOfYear: (SummaryGame & { reason: 'rating' | 'hours'; rating: number | null }) | null;
  nick: string | null;
};

export function yearSummary(d: WrappedResponse): YearSummary {
  const all = d.scope === 'all';
  const top3: SummaryGame[] = d.topGames.items.slice(0, 3).map((x) => ({
    id: x.game.id, title: x.game.title, coverUrl: x.game.coverUrl, hours: x.hours, estimated: x.estimated,
  }));
  const best = d.bestGame?.game && d.bestGame.rating !== null ? d.bestGame : null;
  const gameOfYear = best?.game
    ? { id: best.game.id, title: best.game.title, coverUrl: best.game.coverUrl, hours: best.hours || null, estimated: best.estimated, reason: 'rating' as const, rating: best.rating }
    : top3[0] ? { ...top3[0], reason: 'hours' as const, rating: null } : null;
  const platinums = all ? (d.allTime?.platinumByYear.total ?? d.trophies.counts.platinum) : d.trophies.counts.platinum;
  return {
    scope: all ? 'all' : 'year',
    year: d.year,
    hours: d.hours.total,
    hoursEstimated: d.hours.hasEstimate,
    completed: d.finished.completed.count,
    platinums,
    trophies: d.trophies.counts.total,
    top3,
    gameOfYear,
    nick: d.profile.onlineId,
  };
}

/** Плитки сводки: только непустые; часы с одним знаком. */
export function summaryTiles(s: YearSummary): { key: string; value: string; label: string }[] {
  const t: { key: string; value: string; label: string }[] = [];
  if (s.hours !== null && s.hours > 0) t.push({ key: 'hours', value: `${s.hoursEstimated ? '≈ ' : ''}${hoursText(s.hours)}`, label: 'ч в играх' });
  t.push({ key: 'completed', value: formatNumber(s.completed), label: plural(s.completed, ['игра пройдена', 'игры пройдено', 'игр пройдено']) });
  t.push({ key: 'platinums', value: formatNumber(s.platinums), label: plural(s.platinums, ['платина', 'платины', 'платин']) });
  t.push({ key: 'trophies', value: formatNumber(s.trophies), label: plural(s.trophies, ['трофей', 'трофея', 'трофеев']) });
  return t;
}

