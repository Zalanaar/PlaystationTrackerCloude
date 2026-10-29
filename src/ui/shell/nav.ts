// Навигация (docs/design-system.md §8.1): сопоставление пути с вкладками. Чистые функции, без React.
import { NAV_TABS } from '../tokens';

export type NavTab = (typeof NAV_TABS)[number];

/** Вкладка подсвечена на пути `pathname` (query не учитывается). Для `/` только точное совпадение. */
export function isTabActive(pathname: string, tab: { match: readonly string[]; exact?: boolean }): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return tab.match.some((m) => (m === '/' || tab.exact ? p === m : p === m || p.startsWith(`${m}/`)));
}

/** Подвкладка бэклога текущая на пути (точное совпадение с вложенными). */
export function isSubnavActive(pathname: string, href: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return p === href || p.startsWith(`${href}/`);
}
