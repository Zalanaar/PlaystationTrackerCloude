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

/** F25 (аудит UX): экраны без вкладки — тоже с названием в шапке телефона (а не «PS TRACKER»); h1 на них скрыт так же, как на вкладках. */
const PAGE_TITLES: readonly (readonly [string, string])[] = [
  ['/triage', 'Разбор'], ['/profiles', 'Профили'], ['/access', 'Доступ'], ['/health', 'Здоровье'], ['/settings', 'Настройки'],
];

/** Название раздела для шапки телефона: вкладка либо экран из PAGE_TITLES; иначе null (логотип). */
export function sectionTitle(pathname: string): string | null {
  const tab = NAV_TABS.find((n) => isTabActive(pathname, n));
  if (tab) return tab.label;
  return PAGE_TITLES.find(([href]) => isSubnavActive(pathname, href))?.[1] ?? null;
}
