// Чистая логика бэклога (Фаза 11): фильтры жанр/длительность <-> URL <-> query API (контракт 16.4), показ длительности, ручной ввод.
import type { DurationBucket, DurationCounts, GenreCounts, GameDuration, GameStatusValue, HltbStatus, ListSort, SortOrder } from '@/server/collection/types';
import { GENRE_LABELS_RU, GENRE_NONE } from '@/shared/genres';

export const BACKLOG_PAGE = 300;

export const DURATION_BUCKETS: readonly { id: DurationBucket; label: string }[] = [
  { id: 'lt10', label: 'До 10 ч' },
  { id: '10_30', label: '10–30 ч' },
  { id: '30_60', label: '30–60 ч' },
  { id: '60plus', label: '60+ ч' },
  { id: 'unknown', label: 'Неизвестно' },
];
const BUCKET_IDS: readonly string[] = DURATION_BUCKETS.map((b) => b.id);

export const GENRE_OPTIONS: readonly { key: string; label: string }[] = Object.entries(GENRE_LABELS_RU).map(([key, label]) => ({ key, label }));
/** Чипы статуса HLTB (16.4). «Найдено» отдельным чипом не нужно: интересны проблемные случаи. */
export const HLTB_CHIPS: readonly { id: HltbStatus; label: string }[] = [
  { id: 'not_found', label: 'Не найдено на HLTB' },
  { id: 'unchecked', label: 'Не проверено' },
];
export const HLTB_IDS: readonly string[] = ['found', 'not_found', 'unchecked'];
const GENRE_KEYS: readonly string[] = GENRE_OPTIONS.map((g) => g.key);

/** Служебный чип «Без жанра» (16.4): ключ `none`, подписи в GENRE_LABELS_RU нет. */
export const GENRE_NONE_OPTION = { key: GENRE_NONE, label: 'Без жанра' } as const;

/** Счётчик жанрового чипа из genreCounts: нет ключа = 0, нет самого объекта = null (счётчик не показываем). */
export function genreCount(c: GenreCounts | null, key: string): number | null {
  return c ? c[key] ?? 0 : null;
}

export type BacklogSort = Extract<ListSort, 'last_played' | 'title' | 'duration'>;
export type BacklogFilters = { genres: string[]; duration: DurationBucket[]; hltb: HltbStatus[]; sort: BacklogSort; order: SortOrder | null };

export const DEFAULT_BACKLOG: BacklogFilters = { genres: [], duration: [], hltb: [], sort: 'last_played', order: null };
export const BACKLOG_DEFAULT_ORDER: Record<BacklogSort, SortOrder> = { last_played: 'desc', title: 'asc', duration: 'asc' };

/** Варианты селекта: направление длительности выбирается отдельным пунктом. */
export const BACKLOG_SORTS: readonly { id: string; label: string; sort: BacklogSort; order: SortOrder | null }[] = [
  { id: 'last_played', label: 'По последней игре', sort: 'last_played', order: null },
  { id: 'title', label: 'По названию', sort: 'title', order: null },
  { id: 'duration', label: 'По длительности: короткие сверху', sort: 'duration', order: null },
  { id: 'duration_desc', label: 'По длительности: длинные сверху', sort: 'duration', order: 'desc' },
];

export function backlogSortId(f: Pick<BacklogFilters, 'sort' | 'order'>): string {
  return f.sort === 'duration' && f.order === 'desc' ? 'duration_desc' : f.sort;
}

type ParamsLike = { get(name: string): string | null };

function list(raw: string | null): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Разбор URL: неизвестные жанры и бакеты отбрасываются, дубли схлопываются. */
export function parseBacklogFilters(params: ParamsLike): BacklogFilters {
  const genres = [...new Set(list(params.get('genres')).map((g) => (g.toLowerCase() === GENRE_NONE ? GENRE_NONE : g.toUpperCase())).filter((g) => g === GENRE_NONE || GENRE_KEYS.includes(g)))];
  const duration = [...new Set(list(params.get('duration')).filter((d) => BUCKET_IDS.includes(d)))] as DurationBucket[];
  const hltb = [...new Set(list(params.get('hltb')).filter((h) => HLTB_IDS.includes(h)))] as HltbStatus[];
  const s = params.get('sort');
  const sort: BacklogSort = s === 'title' || s === 'duration' ? s : 'last_played';
  const o = params.get('order');
  const order = (o === 'asc' || o === 'desc') && o !== BACKLOG_DEFAULT_ORDER[sort] ? o : null;
  return { genres, duration, hltb, sort, order };
}

/** Адресная строка: только отличия от умолчаний. */
export function backlogToUrl(f: BacklogFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.genres.length) p.set('genres', f.genres.join(','));
  if (f.duration.length) p.set('duration', f.duration.join(','));
  if (f.hltb.length) p.set('hltb', f.hltb.join(','));
  if (f.sort !== DEFAULT_BACKLOG.sort) p.set('sort', f.sort);
  if (f.order && f.order !== BACKLOG_DEFAULT_ORDER[f.sort]) p.set('order', f.order);
  return p;
}

/** Query для GET /api/games (16.4). */
export function backlogToApi(f: BacklogFilters, page: { limit: number; offset: number }): URLSearchParams {
  const p = new URLSearchParams({ status: 'backlog', sort: f.sort });
  if (f.order) p.set('order', f.order);
  if (f.genres.length) p.set('genres', f.genres.join(','));
  if (f.duration.length) p.set('duration', f.duration.join(','));
  if (f.hltb.length) p.set('hltb', f.hltb.join(','));
  p.set('limit', String(page.limit));
  p.set('offset', String(page.offset));
  return p;
}

export function toggleValue<T>(list: readonly T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function hasBacklogFilters(f: BacklogFilters): boolean {
  return f.genres.length > 0 || f.duration.length > 0 || f.hltb.length > 0;
}

export function resetBacklogFilters(f: BacklogFilters): BacklogFilters {
  return { ...f, genres: [], duration: [], hltb: [] };
}

/** Часы для людей: «12», «7,5». */
export function formatHours(h: number): string {
  const r = h >= 10 ? Math.round(h) : Math.round(h * 10) / 10;
  return String(r).replace('.', ',');
}

/** «≈ 12 ч» или «—» для неизвестной. */
export function durationText(d: Pick<GameDuration, 'hours'> | undefined): string {
  return d && d.hours !== null ? `≈ ${formatHours(d.hours)} ч` : '—';
}

export function sourceLabel(source: GameDuration['source']): string | null {
  return source === 'manual' ? 'вручную' : source === 'hltb' ? 'HLTB' : null;
}

export function hltbStatusText(h: GameDuration['hltb']): string {
  if (h.status === 'found') return h.name ? `Найдено: ${h.name}` : 'Найдено';
  if (h.status === 'not_found') return 'На HLTB не найдено';
  return 'Ещё не проверялось';
}

export function bucketCount(c: DurationCounts | null, id: DurationBucket): number | null {
  return c ? c[id] : null;
}

export const MIN_HOURS = 0.1;
export const MAX_HOURS = 1000;

/** Ввод часов: «12», «12,5», «12.5». null = неверно (пусто, не число, вне 0,1..1000). Округление до 0,1 как на сервере. */
export function parseHoursInput(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Math.round(Number(t) * 10) / 10;
  return n >= MIN_HOURS && n <= MAX_HOURS ? n : null;
}

export function hoursInputValue(h: number | null | undefined): string {
  return h === null || h === undefined ? '' : String(h).replace('.', ',');
}

/** Пометка «нет на HLTB»: игра проверена, совпадения нет (в том числе при ручной длительности, контракт 16.4). */
export function isNotOnHltb(d: Pick<GameDuration, 'hltb'> | undefined): boolean {
  return d?.hltb.status === 'not_found';
}

/** Состояние C (Фаза 32): часов нет вовсе и на HLTB не найдено, нужно указать часы вручную. */
export function needsHours(g: { duration?: GameDuration }): boolean {
  return !!g.duration && g.duration.hours === null && isNotOnHltb(g.duration);
}

// ---------- Два блока страницы «Бэклог»: бэклог и сервис ----------
export type StatusLists<T> = { backlog: T[]; service: T[]; shelved?: T[] };

/** Перенос игры между блоками при смене статуса: убрать из всех, добавить в блок нового статуса (в начало). Дельты счётчиков для `total`. */
export function moveBetweenLists<T extends { id: number; status: GameStatusValue | null }>(
  lists: StatusLists<T>, game: T, to: GameStatusValue | null,
): { lists: Required<StatusLists<T>>; backlogDelta: number; serviceDelta: number; shelvedDelta: number } {
  const shelvedIn = lists.shelved ?? [];
  const inB = lists.backlog.some((g) => g.id === game.id);
  const inS = lists.service.some((g) => g.id === game.id);
  const inH = shelvedIn.some((g) => g.id === game.id);
  let backlog = lists.backlog.filter((g) => g.id !== game.id);
  let service = lists.service.filter((g) => g.id !== game.id);
  let shelved = shelvedIn.filter((g) => g.id !== game.id);
  let backlogDelta = inB ? -1 : 0;
  let serviceDelta = inS ? -1 : 0;
  let shelvedDelta = inH ? -1 : 0;
  const next = { ...game, status: to };
  if (to === 'backlog') { backlog = [next, ...backlog]; backlogDelta += 1; }
  if (to === 'service') { service = [next, ...service]; serviceDelta += 1; }
  if (to === 'shelved') { shelved = [next, ...shelved]; shelvedDelta += 1; }
  return { lists: { backlog, service, shelved }, backlogDelta, serviceDelta, shelvedDelta };
}

/** Запрос блока «Отложено»: фильтры бэклога его не затрагивают. */
export function shelvedToApi(limit = BACKLOG_PAGE): URLSearchParams {
  return new URLSearchParams({ status: 'shelved', sort: 'last_played', limit: String(limit), offset: '0' });
}

/** Запрос блока «Сервис»: фильтры бэклога его не затрагивают. */
export function serviceToApi(limit = BACKLOG_PAGE): URLSearchParams {
  return new URLSearchParams({ status: 'service', sort: 'last_played', limit: String(limit), offset: '0' });
}

// ---------- Вид страницы (Фаза 33): карточки или список ----------
export const BACKLOG_VIEW_KEY = 'ps-bl-view';
export type BacklogView = 'cards' | 'list';

export function isBacklogView(v: unknown): v is BacklogView {
  return v === 'cards' || v === 'list';
}

/** Вид по умолчанию: на мобильном список, на десктопе карточки; сохранённый выбор главнее. */
export function resolveBacklogView(stored: string | null, mobile: boolean): BacklogView {
  return isBacklogView(stored) ? stored : mobile ? 'list' : 'cards';
}

/** Число активных настроек для бейджа кнопки «Фильтры»: фильтры + 1, если сортировка не по умолчанию. */
export function activeBacklogCount(f: BacklogFilters): number {
  const sortChanged = f.sort !== DEFAULT_BACKLOG.sort || (f.order !== null && f.order !== BACKLOG_DEFAULT_ORDER[f.sort]);
  return f.genres.length + f.duration.length + f.hltb.length + (sortChanged ? 1 : 0);
}

/** Строка длительности в списке: null, если показывать нечего (нет часов и нет пометки «нет на HLTB»). */
export function rowDuration(d: GameDuration | undefined): { text: string | null; source: GameDuration['source']; notOnHltb: boolean } | null {
  const text = d && d.hours !== null ? durationText(d) : null;
  const notOnHltb = isNotOnHltb(d);
  if (text === null && !notOnHltb) return null;
  return { text, source: d?.source ?? null, notOnHltb };
}
