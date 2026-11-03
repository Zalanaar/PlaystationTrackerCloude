// Чистая логика коллекции: фильтры <-> URL <-> query API, дата завершения, оптимистичные правки.
import type { GameItem, GameSort, GameStatusValue, SortOrder, StatusCounts, StatusFilterValue } from '@/server/collection/types';
import { PLATFORM_ALL, parsePlatform, type PlatformKey } from '@/shared/platform-filter';
import { DEFAULT_VIEW, UNSORTED_LABEL, VIEW_MODES, type ViewMode } from '../tokens';

export type StatusTab = 'all' | StatusFilterValue;
export type { ViewMode };

export type Filters = {
  status: StatusTab;
  sort: GameSort;
  /** null = порядок по умолчанию для sort */
  order: SortOrder | null;
  q: string;
  /** null = в URL не задан: берётся сохранённый в localStorage, иначе по умолчанию */
  view: ViewMode | null;
  /** Раздел «Скрытые» (9.2 `hidden=only`): только убранные из коллекции игры */
  hidden: boolean;
  /** Чип «Платина»: только игры с полученной платиной, считается на клиенте (12.6), в URL `?platinum=1` */
  platinum: boolean;
  /** F4: платформа (`?platform=ps5`), null = все. Без параметра в URL берётся запомненная (cookie). */
  platform: PlatformKey | null;
};

/** Сортировка по умолчанию = дата завершения: включает хронику (design-system §4.3). */
export const DEFAULT_SORT: GameSort = 'completed_at';
export const DEFAULT_FILTERS: Filters = { status: 'all', sort: DEFAULT_SORT, order: null, q: '', view: null, hidden: false, platinum: false, platform: null };

export const STATUS_TABS: readonly { id: StatusTab; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'playing', label: 'Играю' },
  { id: 'completed', label: 'Пройдено' },
  { id: 'backlog', label: 'Бэклог' },
  { id: 'dropped', label: 'Брошено' },
  { id: 'shelved', label: 'Отложено' },
  { id: 'service', label: 'Сервис' },
  { id: 'none', label: UNSORTED_LABEL },
];

export const SORT_OPTIONS: readonly { id: GameSort; label: string }[] = [
  { id: 'completed_at', label: 'По дате завершения' },
  { id: 'last_played', label: 'По последней игре' },
  { id: 'title', label: 'По названию' },
  { id: 'hours', label: 'По часам' },
  { id: 'trophies_progress', label: 'По трофеям' },
  { id: 'rating', label: 'По оценке' },
];

export const DEFAULT_ORDER: Record<GameSort, SortOrder> = {
  last_played: 'desc', hours: 'desc', title: 'asc', trophies_progress: 'desc', completed_at: 'desc', rating: 'desc',
};

const SORT_IDS = SORT_OPTIONS.map((s) => s.id);
const TAB_IDS = STATUS_TABS.map((s) => s.id);
export const MAX_QUERY_LENGTH = 100;

type ParamsLike = { get(name: string): string | null };

export function isViewMode(v: string | null | undefined): v is ViewMode {
  return !!v && (VIEW_MODES as readonly string[]).includes(v);
}

/** Платформа из URL: `all` = все, без параметра = запомненная, мусор = все. */
export function parsePlatformParam(raw: string | null, remembered: PlatformKey | null = null): PlatformKey | null {
  if (raw === null) return remembered;
  return raw === PLATFORM_ALL ? null : parsePlatform(raw);
}

/** Разбор URL. Неизвестные и битые значения откатываются к умолчаниям. `platformDefault`: запомненная платформа (F4). */
export function parseFilters(params: ParamsLike, platformDefault: PlatformKey | null = null): Filters {
  const status = params.get('status') as StatusTab | null;
  const sortRaw = params.get('sort') as GameSort | null;
  const sort = sortRaw && SORT_IDS.includes(sortRaw) ? sortRaw : DEFAULT_FILTERS.sort;
  const orderRaw = params.get('order');
  const order = orderRaw === 'asc' || orderRaw === 'desc' ? (orderRaw === DEFAULT_ORDER[sort] ? null : orderRaw) : null;
  const viewRaw = params.get('view');
  return {
    status: status && TAB_IDS.includes(status) ? status : 'all',
    sort,
    order,
    q: (params.get('q') ?? '').slice(0, MAX_QUERY_LENGTH),
    view: isViewMode(viewRaw) ? viewRaw : null,
    hidden: params.get('hidden') === '1',
    platinum: params.get('platinum') === '1',
    platform: parsePlatformParam(params.get('platform'), platformDefault),
  };
}

/** Вид с учётом сохранённого: URL главнее localStorage, затем умолчание. */
export function effectiveView(f: Pick<Filters, 'view'>, stored: string | null | undefined): ViewMode {
  return f.view ?? (isViewMode(stored) ? stored : DEFAULT_VIEW);
}

/** Состояние для адресной строки: только отличия от умолчаний. */
export function filtersToUrl(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status !== 'all') p.set('status', f.status);
  if (f.sort !== DEFAULT_FILTERS.sort) p.set('sort', f.sort);
  if (f.order !== null && f.order !== DEFAULT_ORDER[f.sort]) p.set('order', f.order);
  if (f.q.trim()) p.set('q', f.q);
  if (f.view) p.set('view', f.view);
  if (f.hidden) p.set('hidden', '1');
  if (f.platinum) p.set('platinum', '1');
  if (f.platform) p.set('platform', f.platform);
  return p;
}

/** Query для GET /api/games (контракт 9.2). */
export function filtersToApi(f: Filters, page: { limit: number; offset: number }): URLSearchParams {
  const p = new URLSearchParams();
  const q = f.q.trim();
  if (q) p.set('q', q.slice(0, MAX_QUERY_LENGTH));
  if (f.status !== 'all') p.set('status', f.status);
  p.set('sort', f.sort);
  if (f.order !== null) p.set('order', f.order);
  if (f.hidden) p.set('hidden', 'only');
  if (f.platform) p.set('platform', f.platform);
  p.set('limit', String(page.limit));
  p.set('offset', String(page.offset));
  return p;
}

/** Query блока коллекции: статусы через запятую, свой порядок, поиск общий. */
export function blockQuery(
  statuses: readonly StatusFilterValue[], sort: GameSort, q: string, page: { limit: number; offset: number }, platform: PlatformKey | null = null,
): URLSearchParams {
  const p = new URLSearchParams();
  const t = q.trim();
  if (t) p.set('q', t.slice(0, MAX_QUERY_LENGTH));
  p.set('status', statuses.join(','));
  p.set('sort', sort);
  if (platform) p.set('platform', platform);
  p.set('limit', String(page.limit));
  p.set('offset', String(page.offset));
  return p;
}

/** Хроника строится только при сортировке по дате завершения и не в разделе «Скрытые» (там плоский список). */
export function isChronicleMode(f: Pick<Filters, 'sort'> & Partial<Pick<Filters, 'hidden'>>): boolean {
  return f.sort === 'completed_at' && !f.hidden;
}

/** Попадает ли игра под выбранную вкладку статуса. */
export function matchesStatusTab(g: Pick<GameItem, 'status'>, tab: StatusTab): boolean {
  return tab === 'all' || (g.status ?? 'none') === tab;
}

/** Фильтры, которые сбрасывает «Сбросить» (сортировка, вид и раздел «Скрытые» не считаются). */
export function hasActiveFilters(f: Filters): boolean {
  return f.status !== 'all' || f.q.trim() !== '' || f.platinum || f.platform !== null;
}

/** Точка на кнопке «Фильтры» (моб., §8.3): сортировка не по умолчанию, выбран статус, платина или вид не «Крупно». Поиск видно в самом поле. */
export function filtersDot(f: Pick<Filters, 'sort' | 'status' | 'platinum'> & Partial<Pick<Filters, 'platform'>>, view: ViewMode): boolean {
  return f.sort !== DEFAULT_SORT || f.status !== 'all' || f.platinum || !!f.platform || view !== DEFAULT_VIEW;
}

/** Сброс статуса, поиска, чипа «Платина» и платформы; раздел («Скрытые» или вся коллекция) остаётся. */
export function resetFilters(f: Filters): Filters {
  return { ...f, status: 'all', q: '', platinum: false, platform: null };
}

/** t160u, «Показать» после добавления игры с другой платформы: чистая хроника, где виден блок #other-platforms. */
export function otherBlockFilters(f: Filters): Filters {
  return { ...resetFilters(f), hidden: false, sort: 'completed_at', order: null };
}

/** Платина получена (12.6): единственный признак для чипа «Платина». */
export function hasPlatinum(g: Pick<GameItem, 'trophies'>): boolean {
  return g.trophies?.platinumEarned === true;
}

/** Применить чип «Платина» к списку (без него список возвращается как есть). */
export function applyPlatinum<T extends Pick<GameItem, 'trophies'>>(list: readonly T[], on: boolean): T[] {
  return on ? list.filter(hasPlatinum) : [...list];
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

/** Игра ушла из текущей выдачи (скрыта или возвращена из «Скрытых»): минус один в её статусе и в «Все». */
export function removeFromCounts(c: StatusCounts, status: GameStatusValue | null): StatusCounts {
  const k = status ?? 'none';
  return { ...c, [k]: Math.max(0, c[k] - 1), all: Math.max(0, c.all - 1) };
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

/** Слово подтверждения сброса всех статусов. На сервер уходит `{"confirm":"RESET"}` (контракт 9.8). */
export const RESET_WORD = 'СБРОС';

/** Ввод подтверждения: без учёта регистра и пробелов по краям. */
export function isResetWord(v: string): boolean {
  return v.trim().toLocaleUpperCase('ru-RU') === RESET_WORD;
}
