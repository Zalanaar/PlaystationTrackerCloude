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

export type Plan = { entries: WhatsNewEntry[]; /** что записать в ключ при закрытии */ markTo: number; firstRun: boolean };

/**
 * Что показать автоматически. Первый запуск (ключа нет): до 3 записей с highlight с наибольшим id, остальные считаются прочитанными.
 * Иначе: записи с id больше сохранённого, не больше 3 (самые новые), закрытие отмечает все.
 */
export function planAuto(seen: number | null, role: Role, entries: readonly WhatsNewEntry[] = WHATS_NEW_ENTRIES): Plan {
  const mine = forRole(role, entries);
  const markTo = Math.max(latestId(entries), seen ?? 0);
  if (seen === null) return { entries: mine.filter((e) => e.highlight).slice(0, AUTO_MAX), markTo, firstRun: true };
  return { entries: mine.filter((e) => e.id > seen).slice(0, AUTO_MAX), markTo, firstRun: false };
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
