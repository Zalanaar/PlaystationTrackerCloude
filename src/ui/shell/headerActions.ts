// Кнопки мобильной шапки «Поиск» и «+» (D-P2). Шапка не знает о странице: она шлёт событие, страница его слушает.
// Набор кнопок задаётся путём (статично, одинаково на сервере и клиенте), поэтому шапка не меняется после гидрации (CLS 0).
import { useEffect, useRef, useSyncExternalStore } from 'react';

/** F13: 'select' и 'tags' — пункты «Выбрать игры» и «Теги» в меню «⋯» на Коллекции (телефон). */
export type HeaderAction = 'search' | 'add' | 'add-other' | 'add-release' | 'select' | 'tags';
export const HEADER_ACTION_EVENT = 'ps:header-action';

/** П9: пункт меню «+»: на своей странице шлёт событие, с другой ведёт на страницу с параметром, который открывает то же окно. */
export type AddItem = {
  id: 'store' | 'other' | 'release';
  label: string;
  hint: string;
  icon: 'shopping-cart' | 'gamepad' | 'calendar-plus';
  /** Своя страница: событие шапки; иначе null и переход по href. */
  action: Extract<HeaderAction, 'add' | 'add-other' | 'add-release'> | null;
  href: string;
};

const ITEMS = {
  store: { id: 'store', label: 'Не куплено (PS)', hint: 'Игра из магазина PS в бэклог', icon: 'shopping-cart', page: '/backlog', action: 'add', href: '/backlog?add=store' },
  other: { id: 'other', label: 'Другая платформа', hint: 'Switch, Xbox, PC', icon: 'gamepad', page: '/', action: 'add-other', href: '/?add=other' },
  release: { id: 'release', label: 'Релиз в План', hint: 'Игра, которая ещё не вышла', icon: 'calendar-plus', page: '/roadmap', action: 'add-release', href: '/roadmap?add=release' },
} as const;

const norm = (pathname: string) => (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname);

/** Какие кнопки показывает мобильная шапка на пути. «+» — меню выбора (П9) на Коллекции, Бэклоге и Плане. */
export function headerActionsFor(pathname: string): { search: boolean; add: boolean } {
  const p = norm(pathname);
  return { search: localSearchOn(p) || GLOBAL_SEARCH_PATHS.some((x) => p === x || p.startsWith(`${x}/`)), add: p === '/' || p === '/backlog' || p === '/roadmap' };
}

/** Идея 2: Коллекция и Бэклог ищут сами (строка поиска списка); в остальных разделах кнопка открывает лист «Найти игру». */
export const localSearchOn = (pathname: string) => { const p = norm(pathname); return p === '/' || p === '/backlog'; };
const GLOBAL_SEARCH_PATHS = ['/stats', '/trophies', '/roadmap', '/recommend', '/wrapped', '/triage'];

/** F13: группа «Коллекция» в меню «⋯» (телефон) — только на самой Коллекции. */
export const collectionMenuOn = (pathname: string) => norm(pathname) === '/';

/** Пункты меню «+»: первым — то, что добавляют на этой странице. */
export function addItemsFor(pathname: string): AddItem[] {
  const p = norm(pathname);
  const all = [ITEMS.store, ITEMS.other, ITEMS.release];
  const own = all.find((i) => i.page === p);
  const ordered = own ? [own, ...all.filter((i) => i !== own)] : all;
  return ordered.map(({ page, action, ...rest }) => ({ ...rest, action: page === p ? action : null }));
}

export function emitHeaderAction(action: HeaderAction): void {
  window.dispatchEvent(new CustomEvent<HeaderAction>(HEADER_ACTION_EVENT, { detail: action }));
}

/** Страница подписывается на кнопку шапки. Обработчик берётся последний, без переподписки. */
export function useHeaderAction(action: HeaderAction, handler: () => void): void {
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<HeaderAction>).detail === action) ref.current(); };
    window.addEventListener(HEADER_ACTION_EVENT, on);
    return () => window.removeEventListener(HEADER_ACTION_EVENT, on);
  }, [action]);
}

/** Открыта ли локальная строка поиска (Коллекция / Бэклог) — для aria-expanded кнопки шапки. */
let headerSearchOpen = false;
const headerSearchListeners = new Set<() => void>();

export function setHeaderSearchOpen(open: boolean): void {
  if (headerSearchOpen === open) return;
  headerSearchOpen = open;
  headerSearchListeners.forEach((fn) => fn());
}

function subscribeHeaderSearch(fn: () => void): () => void {
  headerSearchListeners.add(fn);
  return () => { headerSearchListeners.delete(fn); };
}

export function useHeaderSearchOpen(): boolean {
  return useSyncExternalStore(subscribeHeaderSearch, () => headerSearchOpen, () => false);
}
