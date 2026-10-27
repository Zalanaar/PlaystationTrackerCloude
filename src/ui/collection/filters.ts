// Чистая логика коллекции: фильтры <-> URL <-> query API, дата завершения, оптимистичные правки.
import type { GameItem, GameSort, GameStatusValue, SortOrder, StatusCounts, StatusFilterValue } from '@/server/collection/types';

export type StatusTab = 'all' | StatusFilterValue;
export type ViewMode = 'grid' | 'list';

export type Filters = {
  status: StatusTab;
  year: number | null;
  sort: GameSort;
  /** null = порядок по умолчанию для sort */
  order: SortOrder | null;
  q: string;
  view: ViewMode;
};

export const DEFAULT_FILTERS: Filters = { status: 'all', year: null, sort: 'last_played', order: null, q: '', view: 'grid' };

export const STATUS_TABS: readonly { id: StatusTab; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'playing', label: 'Играю' },
  { id: 'completed', label: 'Пройдено' },
  { id: 'backlog', label: 'Бэклог' },
  { id: 'dropped', label: 'Брошено' },
  { id: 'shelved', label: 'Отложено' },
  { id: 'none', label: 'Без статуса' },
];

export const SORT_OPTIONS: readonly { id: GameSort; label: string }[] = [
  { id: 'last_played', label: 'По последней игре' },
  { id: 'title', label: 'По названию' },
  { id: 'hours', label: 'По часам' },
  { id: 'trophies_progress', label: 'По трофеям' },
  { id: 'completed_at', label: 'По дате завершения' },
];

export const DEFAULT_ORDER: Record<GameSort, SortOrder> = {
  last_played: 'desc', hours: 'desc', title: 'asc', trophies_progress: 'desc', completed_at: 'desc',
};

const SORT_IDS = SORT_OPTIONS.map((s) => s.id);
const TAB_IDS = STATUS_TABS.map((s) => s.id);
export const MAX_QUERY_LENGTH = 100;

type ParamsLike = { get(name: string): string | null };

/** Разбор URL. Неизвестные и битые значения откатываются к умолчаниям. */
export function parseFilters(params: ParamsLike): Filters {
  const status = params.get('status') as StatusTab | null;
  const yearRaw = params.get('year');
  const year = yearRaw && /^\d{4}$/.test(yearRaw) && +yearRaw >= 2000 && +yearRaw <= 2100 ? +yearRaw : null;
  const sortRaw = params.get('sort') as GameSort | null;
  const sort = sortRaw && SORT_IDS.includes(sortRaw) ? sortRaw : DEFAULT_FILTERS.sort;
  const orderRaw = params.get('order');
  const order = orderRaw === 'asc' || orderRaw === 'desc' ? (orderRaw === DEFAULT_ORDER[sort] ? null : orderRaw) : null;
  return {
    status: status && TAB_IDS.includes(status) ? status : 'all',
    year,
    sort,
    order,
    q: (params.get('q') ?? '').slice(0, MAX_QUERY_LENGTH),
    view: params.get('view') === 'list' ? 'list' : 'grid',
  };
}

/** Состояние для адресной строки: только отличия от умолчаний. */
export function filtersToUrl(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status !== 'all') p.set('status', f.status);
  if (f.year !== null) p.set('year', String(f.year));
  if (f.sort !== DEFAULT_FILTERS.sort) p.set('sort', f.sort);
  if (f.order !== null && f.order !== DEFAULT_ORDER[f.sort]) p.set('order', f.order);
  if (f.q.trim()) p.set('q', f.q);
  if (f.view === 'list') p.set('view', 'list');
  return p;
}

/** Query для GET /api/games (контракт 9.2). */
export function filtersToApi(f: Filters, page: { limit: number; offset: number }): URLSearchParams {
  const p = new URLSearchParams();
  const q = f.q.trim();
  if (q) p.set('q', q.slice(0, MAX_QUERY_LENGTH));
  if (f.status !== 'all') p.set('status', f.status);
  if (f.year !== null) p.set('year', String(f.year));
  p.set('sort', f.sort);
  if (f.order !== null) p.set('order', f.order);
  p.set('limit', String(page.limit));
  p.set('offset', String(page.offset));
  return p;
}

/** Фильтры, которые сбрасывает «Сбросить» (сортировка и вид не считаются). */
export function hasActiveFilters(f: Filters): boolean {
  return f.status !== 'all' || f.year !== null || f.q.trim() !== '';
}

export function resetFilters(f: Filters): Filters {
  return { ...f, status: 'all', year: null, q: '' };
}

/** Дата завершения для карточки/строки: у пройденной completedAt, у брошенной droppedAt. */
export function completionInfo(g: Pick<GameItem, 'status' | 'completedAt' | 'droppedAt'>):
  { kind: 'completed' | 'dropped'; iso: string } | null {
  if (g.status === 'completed' && g.completedAt) return { kind: 'completed', iso: g.completedAt };
  if (g.status === 'dropped' && g.droppedAt) return { kind: 'dropped', iso: g.droppedAt };
  return null;
}

/** Локальный аналог правил 1.3 для оптимистичного обновления (сервер всё равно перезапишет ответом). */
export function applyStatusLocally(g: GameItem, status: GameStatusValue | null, nowIso: string): GameItem {
  if (g.status === status) return g;
  const base = g.lastPlayedAt ?? nowIso;
  return {
    ...g,
    status,
    completedAt: status === 'completed' ? base : null,
    droppedAt: status === 'dropped' ? base : null,
  };
}

export function adjustCounts(c: StatusCounts, from: GameStatusValue | null, to: GameStatusValue | null): StatusCounts {
  if (from === to) return c;
  const next = { ...c };
  next[from ?? 'none'] = Math.max(0, next[from ?? 'none'] - 1);
  next[to ?? 'none'] += 1;
  return next;
}

/** «Продолжить» без дубля «Играю сейчас». */
export function dedupeContinue(playing: GameItem | undefined, list: GameItem[]): GameItem[] {
  return playing ? list.filter((g) => g.id !== playing.id) : list;
}

/** Значение `<input type=date>` (ГГГГ-ММ-ДД, день по Москве) -> ISO. Позже now не бывает: обрезается до now. null = неверный ввод. */
export function dateInputToIso(value: string, nowMs: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  // полдень по Москве (UTC+3), чтобы день не «съехал» при показе
  const ms = Date.UTC(y, mo - 1, d, 9, 0, 0);
  return new Date(Math.min(ms, nowMs)).toISOString();
}

/** ISO -> значение `<input type=date>` по Москве. */
export function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const x = new Date(t + 3 * 3600_000);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}
