// Чистая логика «Когда ты играешь» (Фаза 26, design-system §12.6, §12.8): пики, подписи, заголовки.
import type { PlayPattern } from '@/server/stats/types';
import { plural } from '../format';

export const PATTERN_CAPTION = 'по времени трофеев · МСК';
export const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;
export const WEEKDAY_NOM = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'] as const;
export const MAX_TIED_PEAKS = 3;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** «21:00». */
export const hourLabel = (h: number) => `${pad2(h)}:00`;
/** «21:00-22:00», 23 -> «23:00-00:00». */
export const hourRange = (h: number) => `${pad2(h)}:00-${pad2((h + 1) % 24)}:00`;

export const trophiesCount = (n: number) => `${n} ${plural(n, ['трофей', 'трофея', 'трофеев'])}`;

/** Индексы подсвеченных столбцов: все равные максимуму, но не больше 3 (первые по порядку). Пусто, если максимум 0. */
export function peakIndexes(values: readonly number[]): number[] {
  const max = Math.max(0, ...values);
  if (max <= 0) return [];
  return values.flatMap((v, i) => (v === max ? [i] : [])).slice(0, MAX_TIED_PEAKS);
}

export type PatternBar = { index: number; value: number; heightPct: number; peak: boolean; pct: number; label: string; text: string };

function bars(values: readonly number[], total: number, name: (i: number) => string, range: (i: number) => string): PatternBar[] {
  const max = Math.max(0, ...values);
  const peaks = new Set(peakIndexes(values));
  return values.map((v, i) => {
    const pct = total > 0 ? Math.round((v / total) * 100) : 0;
    const peak = peaks.has(i);
    return {
      index: i, value: v, heightPct: v > 0 && max > 0 ? Math.max(3, (v / max) * 100) : 0, peak, pct, label: range(i),
      text: `${name(i)}: ${trophiesCount(v)}, ${pct}%${peak ? ', пик' : ''}`,
    };
  });
}

export const hourBars = (p: Pick<PlayPattern, 'byHour' | 'total'>): PatternBar[] => {
  const sum = p.total > 0 ? p.total : p.byHour.reduce((a, b) => a + b, 0);
  return bars(p.byHour, sum, hourRange, hourLabel);
};
export const weekdayBars = (p: Pick<PlayPattern, 'byWeekday' | 'total'>): PatternBar[] => {
  const sum = p.total > 0 ? p.total : p.byWeekday.reduce((a, b) => a + b, 0);
  return bars(p.byWeekday, sum, (i) => WEEKDAY_NOM[i] ?? '', (i) => WEEKDAY_SHORT[i] ?? '');
};

/** Данные пригодны для показа: hasData и корректные размеры массивов. */
export function patternReady(p: PlayPattern | undefined): p is PlayPattern {
  return !!p && p.hasData && p.byHour.length === 24 && p.byWeekday.length === 7 && p.peakHour !== null && p.peakWeekday !== null;
}

/** «Чаще всего: 21:00-22:00, пятница» без разметки (для aria и тестов). */
export function patternSummary(p: PlayPattern): string | null {
  if (p.peakHour === null || p.peakWeekday === null) return null;
  return `Чаще всего: ${hourRange(p.peakHour)}, ${(WEEKDAY_NOM[p.peakWeekday] ?? '').toLowerCase()}`;
}

/** Заголовок слайда по пиковому часу (§12.8). */
export function patternHeadline(peakHour: number): string {
  if (peakHour >= 5 && peakHour <= 10) return 'Ты играешь по утрам';
  if (peakHour >= 11 && peakHour <= 16) return 'Ты играешь днём';
  if (peakHour >= 17 && peakHour <= 22) return 'Ты играешь вечерами';
  return 'Ты играешь по ночам';
}

/** aria-label слайда. */
export function patternSlideLabel(p: PlayPattern): string {
  if (p.peakHour === null || p.peakWeekday === null) return 'Когда ты играешь';
  return `Чаще всего ты получаешь трофеи в ${hourRange(p.peakHour)}, любимый день ${(WEEKDAY_NOM[p.peakWeekday] ?? '').toLowerCase()}`;
}

/** Следующий индекс при навигации стрелками по roving tabindex. */
export function rovingNext(key: string, index: number, count: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return Math.min(count - 1, index + 1);
  if (key === 'ArrowLeft' || key === 'ArrowUp') return Math.max(0, index - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
