// Чистая логика экрана «Играл на другой платформе» (design-system §19c). Без React.
import { formatDayMonth, plural } from '../format';
import { fold, truncate } from '../collection/manual';
import type { OtherPlatformGame } from './api';

export const PAGE_SIZE = 30;
/** Фильтр показывается, когда записей больше 10 (19c.2). */
export const FILTER_MIN = 11;

/** createdAt убыв., id убыв. */
export function sortOther(items: readonly OtherPlatformGame[]): OtherPlatformGame[] {
  return [...items].sort((a, b) => (a.createdAt === b.createdAt ? b.id - a.id : a.createdAt < b.createdAt ? 1 : -1));
}

export const filterOther = (items: readonly OtherPlatformGame[], q: string): OtherPlatformGame[] => {
  const n = fold(q.trim());
  return n ? items.filter((g) => fold(g.title).includes(n)) : [...items];
};

/** Новые записи поверх списка, повторы по id убираются. */
export function mergeOther(items: readonly OtherPlatformGame[], added: readonly OtherPlatformGame[]): OtherPlatformGame[] {
  const ids = new Set(added.map((a) => a.id));
  return sortOther([...added, ...items.filter((g) => !ids.has(g.id))]);
}

export const addedDateText = (iso: string): string => `Добавлено ${formatDayMonth(iso, true) ?? ''}`.trim();

export const removedToastText = (title: string): string => `Убрано из списка: «${truncate(title)}»`;

export function addedToastText(titles: readonly string[]): string {
  return titles.length === 1 ? `Добавлено в список: «${truncate(titles[0])}»` : `Добавлено в список: ${titles.length}`;
}

export const foundGamesText = (n: number): string => `Найдено ${n} ${plural(n, ['игра', 'игры', 'игр'])}`;

export const moreText = (left: number): string => `Показать ещё (${left})`;

type ErrLike = { status: number; code: string; details?: unknown };
const isErrLike = (e: unknown): e is ErrLike => typeof e === 'object' && e !== null && typeof (e as ErrLike).status === 'number' && typeof (e as ErrLike).code === 'string';

/** Ошибка добавления: manual_limit с числом из ответа, иначе общий текст. */
export function addErrorText(e: unknown): string {
  if (isErrLike(e) && e.code === 'manual_limit') {
    const limit = (e.details as { limit?: unknown } | undefined)?.limit;
    return `Список заполнен: максимум ${typeof limit === 'number' ? limit : 300} игр. Убери лишние.`;
  }
  return 'Не удалось добавить. Повтори.';
}
