// Чистая логика «Что нового» (спека B.1): кого что показывать, первый запуск, маркер «прочитано», страницы.
import { WHATS_NEW_ENTRIES, type WhatsNewEntry } from './entries';

export type Role = 'owner' | 'member';

/** Сколько записей за один показ и сколько в повторе из меню */
export const AUTO_MAX = 3;
export const MENU_MAX = 6;
/** Пауза после готовности страницы (тур стартует через 600 мс и приоритетнее) */
export const SHOW_DELAY_MS = 1500;
/** Если страница не ставит data-tour-ready, ждём не дольше */
export const READY_WAIT_MS = 3000;

export const seenKey = (userId: number | string): string => `ps-wn-seen:${userId}`;

export const latestId = (entries: readonly WhatsNewEntry[] = WHATS_NEW_ENTRIES): number => entries.reduce((m, e) => Math.max(m, e.id), 0);

/** Записи, подходящие роли, по убыванию id */
export function forRole(role: Role, entries: readonly WhatsNewEntry[] = WHATS_NEW_ENTRIES): WhatsNewEntry[] {
  return entries.filter((e) => e.audience === 'all' || role === 'owner').sort((a, b) => b.id - a.id);
}

/** Сохранённое значение: неотрицательное целое. Нет ключа или мусор = null (первый запуск). */
export function parseSeen(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/** P2-16: запись относится к странице (нет paths = к любой). pathname null = без фильтра (повтор из меню). */
export function relevantTo(e: Pick<WhatsNewEntry, 'paths'>, pathname: string | null | undefined): boolean {
  if (pathname === null || pathname === undefined) return true;
  return !e.paths || e.paths.includes(pathname);
}

/**
 * P2-16: сводная отметка — локальная (localStorage этого браузера) и серверная (общая для Safari и PWA).
 * undefined = источник недоступен; null = отметки нет. Берётся наибольшая; обе null = первый запуск.
 */
export function mergeSeen(local: number | null | undefined, server: number | null | undefined): number | null | undefined {
  if (local === undefined && server === undefined) return undefined;
  const nums = [local, server].filter((v): v is number => typeof v === 'number');
  return nums.length ? Math.max(...nums) : null;
}

export type Plan = { entries: WhatsNewEntry[]; /** что записать в ключ при закрытии */ markTo: number; firstRun: boolean };

/**
 * Что показать автоматически. Первый запуск (ключа нет): до 3 записей с highlight с наибольшим id, остальные считаются прочитанными.
 * Иначе: записи с id больше сохранённого, не больше 3 (самые новые), закрытие отмечает все.
 * pathname (P2-16): только записи этой страницы; непрочитанные чужих страниц ждут своей (пустой план ничего не отмечает).
 */
export function planAuto(seen: number | null, role: Role, entries: readonly WhatsNewEntry[] = WHATS_NEW_ENTRIES, pathname: string | null = null): Plan {
  const mine = forRole(role, entries).filter((e) => relevantTo(e, pathname));
  const markTo = Math.max(latestId(entries), seen ?? 0);
  if (seen === null) return { entries: mine.filter((e) => e.highlight).slice(0, AUTO_MAX), markTo, firstRun: true };
  return { entries: mine.filter((e) => e.id > seen).slice(0, AUTO_MAX), markTo, firstRun: false };
}

/** Есть ли непрочитанные записи роли вообще (на любой странице): пока есть, пустой план на чужой странице не отмечает прочитанным */
export function hasUnread(seen: number | null, role: Role, entries: readonly WhatsNewEntry[] = WHATS_NEW_ENTRIES): boolean {
  const mine = forRole(role, entries);
  return seen === null ? mine.some((e) => e.highlight) : mine.some((e) => e.id > seen);
}

/** Повтор из меню: последние 6 записей роли, отметок не меняет */
export function planMenu(role: Role, entries: readonly WhatsNewEntry[] = WHATS_NEW_ENTRIES): WhatsNewEntry[] {
  return forRole(role, entries).slice(0, MENU_MAX);
}

/** Страницы, где карточка показывается сама */
const AUTO_PATHS = ['/', '/backlog', '/stats', '/recommend', '/roadmap'] as const;

export function autoPathAllowed(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (AUTO_PATHS as readonly string[]).includes(pathname);
}

/** Сводное правило видимости автокарточки (без учёта DOM-блокировщиков, их проверяет компонент) */
export function autoVisible(p: { pathname: string | null | undefined; hasGameParam: boolean; tourActive: boolean; toast: boolean }): boolean {
  return autoPathAllowed(p.pathname) && !p.hasGameParam && !p.tourActive && !p.toast;
}

export const counterText = (index: number, total: number): string => `${index + 1} из ${total}`;
export const announceText = (e: Pick<WhatsNewEntry, 'title' | 'text'>): string => `Что нового: ${e.title}. ${e.text}`;
