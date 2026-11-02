// Чистая логика Фазы 43.1: умный поиск в Бэклоге (design-system §19b.5, контракт 43.1.3-43.1.4). Без React и сети.
import type { SearchCandidate } from './manual';
import { fold, normalizeQuery } from './manual';

export { fold };

/** Магазин PS: подсказки от 3 символов (контракт 43.1.3). Локальный список работает с 1. */
export const SUGGEST_MIN = 3;
export const SUGGEST_DEBOUNCE_MS = 350;
export const LIST_DEBOUNCE_MS = 150;
export const LOCAL_MAX = 5;
export const STORE_MAX_POPUP = 5;
export const STORE_MAX_SHEET = 8;
export const SUGGEST_MAX_QUERY = 80;

/** Запрос для подсказок: схлопнутые пробелы, не длиннее 80. */
export const suggestQuery = (raw: string): string => normalizeQuery(raw).slice(0, SUGGEST_MAX_QUERY);
export const cacheKey = (q: string): string => fold(suggestQuery(q));

/** Подстрока по названию без регистра (контракт 43.1.4). */
export function matchesQuery(title: string, q: string): boolean {
  const n = fold(suggestQuery(q));
  return n.length > 0 && fold(title).includes(n);
}

export const filterByTitle = <T extends { title: string }>(items: readonly T[], q: string): T[] => {
  const n = suggestQuery(q);
  return n ? items.filter((x) => matchesQuery(x.title, n)) : [...items];
};

export type HlPart = { text: string; hit: boolean };

/** Подсветка: все вхождения слов запроса (до 3), без учёта регистра и ё/е. */
export function highlightParts(text: string, query: string): HlPart[] {
  const words = [...new Set(fold(suggestQuery(query)).split(' ').filter(Boolean))].slice(0, 3);
  const f = fold(text);
  if (words.length === 0 || f.length !== text.length) return [{ text, hit: false }];
  const mark = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    for (let at = f.indexOf(w); at !== -1; at = f.indexOf(w, at + w.length)) for (let i = at; i < at + w.length; i++) mark[i] = true;
  }
  const parts: HlPart[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.hit === mark[i]) last.text += text[i];
    else parts.push({ text: text[i], hit: mark[i] });
  }
  return parts.length ? parts : [{ text, hit: false }];
}

/** «Введи ещё 2 символа для поиска в магазине PS». */
export function hintText(len: number): string {
  const n = Math.max(1, SUGGEST_MIN - len);
  const word = n === 1 ? 'символ' : 'символа';
  return `Введи ещё ${n} ${word} для поиска в магазине PS`;
}

// ---------- состояние секции «Из магазина PS» ----------

export type StoreState =
  | { kind: 'idle' }
  | { kind: 'hint'; len: number }
  | { kind: 'loading' }
  | { kind: 'results'; items: SearchCandidate[] }
  | { kind: 'empty' }
  | { kind: 'limited' }
  | { kind: 'quota'; resetAt: string | null }
  | { kind: 'error' }
  | { kind: 'offline' }
  | { kind: 'hidden' };

export type SuggestFailure =
  | { kind: 'limited'; resetAt: string | null }
  | { kind: 'quota'; resetAt: string | null }
  | { kind: 'hidden' }
  | { kind: 'offline' }
  | { kind: 'error' };

type ErrLike = { status: number; code: string; details?: unknown };
const isErrLike = (e: unknown): e is ErrLike => typeof e === 'object' && e !== null && typeof (e as ErrLike).status === 'number' && typeof (e as ErrLike).code === 'string';
const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Разбор отказа подсказок (43.1.3): 429 suggest_limited / quota, 503 no_key = каталог не настроен, остальное = ошибка. */
export function classifySuggestError(e: unknown, online: boolean): SuggestFailure {
  if (!online) return { kind: 'offline' };
  if (isErrLike(e)) {
    const d = (e.details ?? {}) as { reason?: unknown; resetAt?: unknown };
    if (e.status === 429 && d.reason === 'suggest_limited') return { kind: 'limited', resetAt: asStr(d.resetAt) };
    if (e.status === 429 && d.reason === 'quota') return { kind: 'quota', resetAt: asStr(d.resetAt) };
    if (e.status === 503 && e.code === 'catalog_unavailable') {
      if (d.reason === 'no_key') return { kind: 'hidden' };
      if (d.reason === 'rate_limited') return { kind: 'quota', resetAt: asStr(d.resetAt) };
    }
  }
  return { kind: 'error' };
}

/** Состояние секции магазина по длине запроса и результату (после проверки блокировок и сети). */
export function storeStateFor(len: number, list: readonly SearchCandidate[] | null, max: number): StoreState {
  if (len === 0) return { kind: 'idle' };
  if (len < SUGGEST_MIN) return { kind: 'hint', len };
  if (list === null) return { kind: 'loading' };
  return list.length > 0 ? { kind: 'results', items: list.slice(0, max) } : { kind: 'empty' };
}

// ---------- блокировки до resetAt ----------

/** Время сброса, когда сервер его не прислал: подсказки не возвращаются хотя бы на 6 часов. */
export const FALLBACK_BLOCK_MS = 6 * 3600_000;

export type Guard = {
  /** мягкий предел: автоподсказки отключены до resetAt, Enter-поиск работает */
  limit(resetAt: string | null, now?: number): void;
  /** жёсткая квота: подсказки и Enter-поиск отключены до resetAt */
  quota(resetAt: string | null, now?: number): void;
  /** каталог не настроен: подсказки не запрашиваются в этой сессии */
  unavailable(): void;
  status(now?: number): { limited: boolean; quota: boolean; hidden: boolean; quotaResetAt: string | null };
  reset(): void;
};

export function createGuard(): Guard {
  let limitedUntil = 0;
  let quotaUntil = 0;
  let quotaIso: string | null = null;
  let hidden = false;
  const until = (resetAt: string | null, now: number): number => {
    const t = resetAt ? Date.parse(resetAt) : NaN;
    return Number.isFinite(t) && t > now ? t : now + FALLBACK_BLOCK_MS;
  };
  return {
    limit(resetAt, now = Date.now()) { limitedUntil = until(resetAt, now); },
    quota(resetAt, now = Date.now()) { quotaUntil = until(resetAt, now); quotaIso = resetAt; },
    unavailable() { hidden = true; },
    status(now = Date.now()) {
      return { limited: now < limitedUntil, quota: now < quotaUntil, hidden, quotaResetAt: now < quotaUntil ? quotaIso : null };
    },
    reset() { limitedUntil = 0; quotaUntil = 0; quotaIso = null; hidden = false; },
  };
}

/** Состояние секции магазина из блокировок (без запроса). null = блокировок нет. */
export function guardedState(g: ReturnType<Guard['status']>): StoreState | null {
  if (g.hidden) return { kind: 'hidden' };
  if (g.quota) return { kind: 'quota', resetAt: g.quotaResetAt };
  if (g.limited) return { kind: 'limited' };
  return null;
}

// ---------- опции и клавиатура ----------

/** Следующая активная опция: -1 = нет активной; на краях не зацикливается. */
export function moveActive(cur: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (dir === 1) return cur < 0 ? 0 : Math.min(count - 1, cur + 1);
  return cur < 0 ? -1 : Math.max(0, cur - 1);
}

/** Локальные подсказки: игры библиотеки и записи «не куплено», всего не больше max (обе группы получают место). */
export function mergeLocal<A, B>(lib: readonly A[], man: readonly B[], max = LOCAL_MAX): { lib: A[]; man: B[] } {
  if (lib.length + man.length <= max) return { lib: [...lib], man: [...man] };
  const m = Math.min(man.length, Math.max(1, Math.floor(max / 2)));
  const l = Math.min(lib.length, max - m);
  return { lib: lib.slice(0, l), man: man.slice(0, max - l) };
}

/** Что Enter делает без активной опции (§19b.5). */
export function enterWithoutActive(store: StoreState): 'filter' | 'store' {
  return store.kind === 'limited' ? 'store' : 'filter';
}

/** Текст живой области: объявляется после того, как оба источника устоялись. */
export function liveText(localN: number, store: StoreState): string {
  if (store.kind === 'results') return `Из списка: ${localN}. Из магазина PS: ${store.items.length}.`;
  if (store.kind === 'empty') return localN > 0 ? `Из списка: ${localN}. Из магазина PS: 0.` : 'Ничего не найдено';
  if (store.kind === 'limited' || store.kind === 'quota' || store.kind === 'offline' || store.kind === 'error') {
    return localN > 0 ? `Из списка: ${localN}. Подсказки из магазина недоступны.` : 'Подсказки из магазина недоступны';
  }
  if (store.kind === 'hint' || store.kind === 'hidden') return localN > 0 ? `Из списка: ${localN}.` : 'Ничего не найдено';
  return '';
}
