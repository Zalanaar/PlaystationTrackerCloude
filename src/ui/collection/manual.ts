// Чистая логика Фазы 43: игры «не куплено» в Бэклоге (docs/design-system.md §19, docs/api-contract.md Фаза 43).
import type { CatalogCandidate } from '@/server/catalog/rawg';
import { catalogPage } from '@/server/catalog/links';
import type { DuplicateInfo, ManualGame } from '@/server/manual/store';
import type { DurationBucket, HltbStatus } from '@/server/collection/types';
import { GENRE_NONE } from '@/shared/genres';

export type { ManualGame, ManualMatch, GameRef, DuplicateInfo, BatchResult } from '@/server/manual/store';

/** Кандидат поиска с пометками сервера (43.3). */
export type SearchCandidate = CatalogCandidate & { duplicate: 'library' | 'planned' | null; inBacklog: boolean };
export type SearchResponse = { candidates: SearchCandidate[]; cached: boolean };

export const MIN_QUERY = 2;
/** Сервер принимает 2..80 символов (43.3), поле ограничено так же. */
export const MAX_QUERY = 80;
export const MAX_RESULTS = 20;

const MONTHS_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

/** Регистр и «ё/е» не различаются. */
export const fold = (s: string): string => s.toLowerCase().replace(/ё/g, 'е');
export const normalizeQuery = (q: string): string => q.trim().replace(/\s+/g, ' ');
export const canSearch = (q: string): boolean => normalizeQuery(q).length >= MIN_QUERY;

type Rel = { y: number; m: number | null; d: number | null };

/** «2026-11-12» или «2026» без пересчёта часовых поясов; остальное = нет даты. */
export function parseRelease(raw: string | null | undefined): Rel | null {
  if (!raw) return null;
  let r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (r) {
    const m = Number(r[2]);
    const d = Number(r[3]);
    return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { y: Number(r[1]), m, d } : null;
  }
  r = /^(\d{4})$/.exec(raw);
  return r ? { y: Number(r[1]), m: null, d: null } : null;
}

const dayText = (r: Rel): string => (r.m !== null && r.d !== null ? `${r.d} ${MONTHS_SHORT[r.m - 1]} ${r.y}` : String(r.y));

/** Дата релиза в строке/карточке Бэклога. today = YYYY-MM-DD по Москве (mskDay). */
export function releaseMeta(raw: string | null | undefined, today: string): string {
  const r = parseRelease(raw);
  if (!r) return 'Дата не объявлена';
  if (r.m === null || r.d === null) return `Вышла в ${r.y}`;
  return `${raw! > today ? 'Выйдет' : 'Вышла'} ${dayText(r)}`;
}

/** Мета под названием: до покупки дата релиза, после «Купил» ждём первый запуск. */
export function manualMeta(g: Pick<ManualGame, 'notPurchased' | 'releaseDate'>, today: string): string {
  return g.notPurchased ? releaseMeta(g.releaseDate, today) : 'Ждём первый запуск';
}

/** aria-label карточки: «{название}, бэклог, не куплено, {мета}». */
export function manualAria(g: Pick<ManualGame, 'title' | 'notPurchased' | 'releaseDate'>, today: string): string {
  return `${g.title}, бэклог${g.notPurchased ? ', не куплено' : ''}, ${manualMeta(g, today)}`;
}

/** «Релиз 12 нояб. 2026» / «Релиз 2027» / «Дата не объявлена» (строка результата поиска). */
export function searchReleaseText(raw: string | null | undefined): string {
  const r = parseRelease(raw);
  return r ? `Релиз ${dayText(r)}` : 'Дата не объявлена';
}

/** «PS5 · PS4»: только PlayStation из ответа RAWG (PS5 первой). Пусто, если нечего показать. */
export function platformsText(platforms: readonly string[]): string {
  const has = (re: RegExp) => platforms.some((p) => re.test(p));
  return [has(/playstation\s*5|\bps5\b/i) ? 'PS5' : null, has(/playstation\s*4|\bps4\b/i) ? 'PS4' : null].filter(Boolean).join(' · ');
}

/** Ссылка на страницу игры в RAWG по числовому id (slug клиенту не приходит). Нет ссылки = null. */
export function rawgUrl(g: Pick<ManualGame, 'externalId'>): string | null {
  return /^\d{1,12}$/.test(g.externalId) ? `https://rawg.io/games/${g.externalId}` : null;
}

/** Страница игры у её каталога: RAWG или запасной (PlayStation Store, Steam...). */
export const gamePage = (g: Pick<ManualGame, 'externalId'>) => catalogPage(g.externalId);

export const truncate = (s: string, n = 40): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Текст тоста при закрытии панели поиска. */
export function addedToastText(titles: readonly string[]): string {
  return titles.length === 1 ? `Добавлено в бэклог: «${truncate(titles[0])}»` : `Добавлено в бэклог: ${titles.length}`;
}

// ---------- фильтры и список ----------

type FilterLike = { genres: readonly string[]; duration: readonly DurationBucket[]; hltb: readonly HltbStatus[] };

/** У записи нет жанров, длительности и HLTB: она попадает только в «без данных» (§19.2). */
export function manualPassesFilters(f: FilterLike): boolean {
  return (f.genres.length === 0 || f.genres.includes(GENRE_NONE))
    && (f.duration.length === 0 || f.duration.includes('unknown'))
    && (f.hltb.length === 0 || f.hltb.includes('unchecked'));
}

/** Записи Бэклога под текущие фильтры: «Не куплено» оставляет только notPurchased, q = подстрока по названию (43.1.4). */
export function visibleManual(items: readonly ManualGame[], f: FilterLike & { nb: boolean; q?: string }): ManualGame[] {
  if (!manualPassesFilters(f)) return [];
  const byQ = f.q ? items.filter((g) => fold(g.title).includes(fold(f.q!))) : [...items];
  return f.nb ? byQ.filter((g) => g.notPurchased) : byQ;
}

export const countNotPurchased = (items: readonly ManualGame[] | null): number => (items ? items.filter((g) => g.notPurchased).length : 0);

/**
 * Единый порядок показа: записи без данных идут после игр библиотеки (как «без данных» в сортировках);
 * при сортировке по названию встают на своё место по алфавиту. Порядок игр библиотеки (серверный) не меняется.
 */
export function mergeBacklog<T extends { title: string }>(games: readonly T[], manual: readonly ManualGame[], sort: 'last_played' | 'title' | 'duration', order: 'asc' | 'desc' | null): { game: T | null; manual: ManualGame | null }[] {
  const g = games.map((game) => ({ game, manual: null as ManualGame | null }));
  const m = manual.map((item) => ({ game: null as T | null, manual: item }));
  if (sort !== 'title') return [...g, ...m];
  const dir = order === 'desc' ? -1 : 1;
  const cmp = (a: string, b: string) => dir * a.localeCompare(b, 'ru');
  const ms = [...m].sort((a, b) => cmp(a.manual!.title, b.manual!.title));
  const res: { game: T | null; manual: ManualGame | null }[] = [];
  let i = 0;
  for (const x of g) {
    while (i < ms.length && cmp(ms[i].manual!.title, x.game!.title) < 0) res.push(ms[i++]);
    res.push(x);
  }
  while (i < ms.length) res.push(ms[i++]);
  return res;
}

// ---------- ошибки ----------

type ErrLike = { status: number; code: string; details?: unknown };
const isErrLike = (e: unknown): e is ErrLike => typeof e === 'object' && e !== null && typeof (e as ErrLike).status === 'number' && typeof (e as ErrLike).code === 'string';

/** Человеческий текст ошибки записи (добавить/купил/убрать). */
export function manualErrorText(e: unknown, fallback: string): string {
  if (isErrLike(e)) {
    if (e.code === 'manual_limit') return 'В бэклоге уже 200 игр «не куплено». Убери лишние, чтобы добавить новую.';
    if (e.code === 'manual_status_locked') return 'У игры «не куплено» статус менять нельзя. Нажми «Купил», когда купишь её.';
    if (e.status === 503) return 'База данных недоступна. Попробуй позже.';
  }
  return fallback;
}

export type SearchFailure =
  | { kind: 'quota'; resetAt: string | null }
  | { kind: 'unavailable' }
  | { kind: 'offline' }
  | { kind: 'error'; down?: true };

/** Классификация сбоя поиска по ответу сервера (43.3): no_key = каталог не настроен, rate_limited = лимит. */
export function classifySearchError(e: unknown, online: boolean): SearchFailure {
  if (!online) return { kind: 'offline' };
  if (isErrLike(e) && e.status === 503 && e.code === 'catalog_unavailable') {
    const d = (e.details ?? {}) as { reason?: unknown; resetAt?: unknown };
    if (d.reason === 'no_key') return { kind: 'unavailable' };
    if (d.reason === 'rate_limited') return { kind: 'quota', resetAt: typeof d.resetAt === 'string' ? d.resetAt : null };
    // RAWG не ответил или ответил ошибкой (сбой на их стороне): говорим это прямо, а не «ничего не находит»
    if (d.reason === 'timeout' || d.reason === 'network' || d.reason === 'http_error' || d.reason === 'bad_response') return { kind: 'error', down: true };
  }
  return { kind: 'error' };
}

export const SEARCH_DOWN_TEXT = 'Каталог игр RAWG сейчас не отвечает: сбой на их стороне. Попробуй позже.';

/** Текст баннера ошибки поиска (error/offline). */
export function searchErrorText(f: SearchFailure, online: boolean): string {
  if (f.kind === 'offline' || !online) return 'Нет соединения. Поиск недоступен офлайн.';
  return f.kind === 'error' && f.down ? `Не удалось выполнить поиск. ${SEARCH_DOWN_TEXT}` : 'Не удалось выполнить поиск.';
}

/** Данные блока дубля (409 duplicate_game): разбор details, null = не дубль. */
export function parseDuplicate(e: unknown): DuplicateInfo | null {
  if (!isErrLike(e) || e.status !== 409 || e.code !== 'duplicate_game') return null;
  const d = e.details as Partial<DuplicateInfo> | undefined;
  if (!d || (d.duplicate !== 'library' && d.duplicate !== 'planned')) return null;
  return { duplicate: d.duplicate, game: d.game ?? null, planned: d.planned ?? null };
}

/** Игра исчезла/уже обработана (404/409): считаем успехом и обновляем список (§19.5, §19.6). */
export function isGoneOrDone(e: unknown): boolean {
  return isErrLike(e) && (e.status === 404 || (e.status === 409 && e.code !== 'manual_limit' && e.code !== 'duplicate_game'));
}

/** Локально снять/вернуть пометку «не куплено» (оптимистично). */
export function setNotPurchased(items: readonly ManualGame[], id: number, value: boolean): ManualGame[] {
  return items.map((g) => (g.id === id ? { ...g, notPurchased: value } : g));
}

export const removeManualById = (items: readonly ManualGame[], id: number): ManualGame[] => items.filter((g) => g.id !== id);
