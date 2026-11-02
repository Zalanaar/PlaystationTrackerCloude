// Чистая логика «Это та игра?» (Фаза 43, design-system §19.6).
import type { ManualMatch } from '@/server/manual/store';
import { formatDayMonth } from '../format';

export type { ManualMatch };
export const MATCH_PAGE = 10;

/** «Последний запуск 5 окт.» или «Играл 12 ч» (если даты нет); пусто, если нет ни того ни другого. */
export function matchGameMeta(g: Pick<ManualMatch['game'], 'lastPlayedAt' | 'hours'>, formatHours: (h: number) => string): string {
  const d = formatDayMonth(g.lastPlayedAt);
  if (d) return `Последний запуск ${d}`;
  return g.hours > 0 ? `Играл ${formatHours(g.hours)} ч` : 'Нет данных о запуске';
}

export const matchToast = (answer: 'yes' | 'no', m: Pick<ManualMatch, 'title' | 'game'>): string =>
  answer === 'yes' ? `Игра связана: «${m.game.name}»` : `Оставили как есть: «${m.title}»`;

/** Показ порциями по 10, остальное через «Показать ещё». */
export const visibleMatches = <T,>(list: readonly T[], shown: number): T[] => list.slice(0, shown);
