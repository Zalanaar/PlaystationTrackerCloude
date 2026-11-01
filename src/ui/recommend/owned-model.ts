// Чистая логика «Уже есть» (спека Фазы 40, §16; контракт «Фаза 40»). Без React и сети.
import type { OwnedMark } from './api';

export const OWN_BUTTON = 'Уже есть / проходил';
export const OWN_MODES = [
  { value: 'covered', label: 'Входит в игру из библиотеки' },
  { value: 'none', label: 'Нет в библиотеке' },
] as const;
export type OwnMode = (typeof OWN_MODES)[number]['value'];

export const RECENT_LIMIT = 5;
export const LIST_PAGE = 50;
export const FILTER_MIN_MARKS = 5;
export const TOAST_TITLE_MAX = 40;

export type LibraryGame = { id: number; name: string; imageUrl: string | null };

/** Для поиска: нижний регистр, ё = е, схлопнутые пробелы. */
export function normalizeQuery(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** Фильтр по названию (подстрока), порядок входного списка сохраняется. */
export function filterLibrary<T extends { name: string }>(games: readonly T[], query: string): T[] {
  const q = normalizeQuery(query);
  if (!q) return [...games];
  return games.filter((g) => normalizeQuery(g.name).includes(q));
}

/** Алфавит без учёта регистра и ё/е; при равенстве по id. */
export function sortLibrary<T extends { id: number; name: string }>(games: readonly T[]): T[] {
  return [...games].sort((a, b) => normalizeQuery(a.name).localeCompare(normalizeQuery(b.name), 'ru') || a.id - b.id);
}

/** Недавно выбранные не дублируются в общем списке «Библиотека». */
export function withoutRecent<T extends { id: number }>(games: readonly T[], recentIds: readonly number[]): T[] {
  const skip = new Set(recentIds);
  return games.filter((g) => !skip.has(g.id));
}

/** Название для тоста: до 40 символов, дальше «…». */
export function toastTitle(title: string, max = TOAST_TITLE_MAX): string {
  const chars = Array.from(title);
  return chars.length <= max ? title : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

export const removedText = (title: string) => `Убрано из подборки: «${toastTitle(title)}»`;
export const returnedText = (title: string) => `Возвращено в подборку: «${toastTitle(title)}»`;

export type PutBody =
  | { externalSource: 'rawg'; externalId: string; title: string; coverUrl: string | null; kind: 'covered'; coveredByGameId: number }
  | { externalSource: 'rawg'; externalId: string; title: string; coverUrl: string | null; kind: 'not_in_library'; completed: boolean };

type Ext = { externalId: string; title: string; coverUrl: string | null };

/** Тело PUT: у covered нет `completed`, у not_in_library нет `coveredByGameId` (иначе сервер вернёт 400). */
export function buildPutBody(item: Ext, mode: OwnMode, gameId: number | null, completed: boolean): PutBody | null {
  const base = { externalSource: 'rawg' as const, externalId: item.externalId, title: item.title, coverUrl: item.coverUrl };
  if (mode === 'covered') return gameId === null ? null : { ...base, kind: 'covered', coveredByGameId: gameId };
  return { ...base, kind: 'not_in_library', completed };
}

/** Подпись под названием в «Отмеченных». */
export function markLabel(m: Pick<OwnedMark, 'kind' | 'completed' | 'coveredBy'>): string {
  const parts = [m.kind === 'covered' && m.coveredBy ? `Входит в «${m.coveredBy.name}»` : 'Нет в библиотеке'];
  if (m.completed) parts.push('Прошёл');
  return parts.join(' · ');
}

/** «3 нояб.» по Москве. */
export function markDate(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' }).format(d).replace(/\s?г\.$/, '');
}

export const MARK_FILTERS = [
  { value: 'all', label: 'Все' },
  { value: 'covered', label: 'Входят в игру' },
  { value: 'completed', label: 'Прошёл' },
] as const;
export type MarkFilter = (typeof MARK_FILTERS)[number]['value'];

export function matchesFilter(m: Pick<OwnedMark, 'kind' | 'completed'>, f: MarkFilter): boolean {
  if (f === 'covered') return m.kind === 'covered';
  if (f === 'completed') return m.completed;
  return true;
}

export function markCounts(marks: readonly Pick<OwnedMark, 'kind' | 'completed'>[]): Record<MarkFilter, number> {
  return {
    all: marks.length,
    covered: marks.filter((m) => matchesFilter(m, 'covered')).length,
    completed: marks.filter((m) => matchesFilter(m, 'completed')).length,
  };
}

/** Свежие сверху по дате отметки. Порядок сервера (updatedAt) уважаем, но не полагаемся. */
export function sortMarks<T extends Pick<OwnedMark, 'updatedAt' | 'externalId'>>(marks: readonly T[]): T[] {
  return [...marks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.externalId.localeCompare(b.externalId));
}

export function foundText(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? 'игра' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'игры' : 'игр';
  return `Найдено ${n} ${word}`;
}
