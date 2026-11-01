// Чистая логика подсказки «Установить» (design-system §15.2): когда показывать, snooze, счётчики. Без DOM и хранилища.

export const INSTALL_KEYS = {
  visits: 'ps.install.visits',
  snooze: 'ps.install.snooze',
  dismissals: 'ps.install.dismissals',
  done: 'ps.install.done',
} as const;

/** Флаг в sessionStorage: визит этой вкладки уже посчитан */
export const VISIT_COUNTED_KEY = 'ps.install.counted';

/** Задержка показа после загрузки страницы */
export const SHOW_DELAY_MS = 8000;
/** Показ не раньше второго визита */
export const MIN_VISITS = 2;
/** Snooze по номеру закрытия: 1-е = 14 дней, 2-е = 60 дней, 3-е и дальше = навсегда */
export const SNOOZE_DAYS = [14, 60] as const;
const DAY_MS = 86_400_000;

export type InstallStored = {
  visits: number;
  /** epoch ms, «не показывать до»; null = нет */
  snoozeUntil: number | null;
  dismissals: number;
  done: boolean;
};

export const EMPTY_STORED: InstallStored = { visits: 0, snoozeUntil: null, dismissals: 0, done: false };

/** Неотрицательное целое из строки; мусор = 0 */
export function parseCount(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || !/^\d+$/.test(raw)) return 0;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : 0;
}

/** ISO-время в epoch ms; мусор = null */
export function parseSnooze(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

export function parseStored(raw: { visits?: string | null; snooze?: string | null; dismissals?: string | null; done?: string | null }): InstallStored {
  return {
    visits: parseCount(raw.visits),
    snoozeUntil: parseSnooze(raw.snooze),
    dismissals: parseCount(raw.dismissals),
    done: raw.done === '1',
  };
}

/** «Не сейчас» / ✕ / «Понятно» / dismissed системного диалога */
export function dismissOnce(s: InstallStored, now: number): InstallStored {
  const dismissals = s.dismissals + 1;
  const days = SNOOZE_DAYS[dismissals - 1];
  if (days === undefined) return { ...s, dismissals, snoozeUntil: null, done: true };
  return { ...s, dismissals, snoozeUntil: now + days * DAY_MS };
}

/** Установлено или принято: больше не показываем никогда */
export function markDone(s: InstallStored): InstallStored {
  return { ...s, done: true, snoozeUntil: null };
}

/** Хранилище учитывает визиты: сессия увеличивает счётчик на 1 */
export function addVisit(s: InstallStored): InstallStored {
  return { ...s, visits: s.visits + 1 };
}

/** Страницы, где подсказка не показывается (тур, окна и сторис проверяются отдельно) */
const EXCLUDED_PREFIXES = ['/login', '/onboarding', '/wrapped', '/triage'] as const;
export function isPathAllowed(pathname: string): boolean {
  return !EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export type InstallPlatform = 'ios' | 'android' | null;

/** iPhone/iPad по UA; iPadOS 13+ выдаёт себя за Macintosh, отличаем по тач-точкам. Любой браузер на iOS. */
export function isIosDevice(nav: { userAgent: string; maxTouchPoints?: number }): boolean {
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return true;
  return /Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1;
}

/** iPad: панель Safari сверху, стрелку-подсказку вниз не показываем */
export function isIpad(nav: { userAgent: string; maxTouchPoints?: number }): boolean {
  if (/iPad/.test(nav.userAgent)) return true;
  return /Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1;
}

/** Android: только если пришёл beforeinstallprompt. Остальное (десктоп, Firefox) не показываем. */
export function platformFor(opts: { ios: boolean; hasPrompt: boolean }): InstallPlatform {
  if (opts.hasPrompt) return 'android';
  if (opts.ios) return 'ios';
  return null;
}

/** Условия по хранилищу: не done, не раньше 2-го визита, snooze истёк */
export function storageAllows(s: InstallStored, now: number): boolean {
  if (s.done) return false;
  if (s.visits < MIN_VISITS) return false;
  if (s.snoozeUntil !== null && now < s.snoozeUntil) return false;
  return true;
}

export type EligibilityInput = {
  /** null: localStorage недоступен (приватный режим) */
  stored: InstallStored | null;
  now: number;
  standalone: boolean;
  mobile: boolean;
  pathname: string;
  platform: InstallPlatform;
  tourActive: boolean;
  /** окно игры, лист, меню, сторис и т.п. */
  overlayOpen: boolean;
  /** на экране «Что нового», тосты или панель выбора: у них приоритет */
  conflictOpen: boolean;
  /** без хранилища: уже показывали за эту сессию */
  shownThisSession: boolean;
};

/** Все условия §15.2 кроме 8-секундной задержки (её держит компонент) */
export function canShowInstall(i: EligibilityInput): boolean {
  if (i.standalone || !i.mobile || i.platform === null) return false;
  if (!isPathAllowed(i.pathname)) return false;
  if (i.tourActive || i.overlayOpen || i.conflictOpen) return false;
  if (i.stored === null) return !i.shownThisSession;
  return storageAllows(i.stored, i.now);
}

/** Ручной вызов из меню: игнорирует snooze, визиты и done, но платформа, standalone и страница важны */
export function canShowManual(i: Pick<EligibilityInput, 'standalone' | 'mobile' | 'platform' | 'pathname'>): boolean {
  return !i.standalone && i.mobile && i.platform !== null && isPathAllowed(i.pathname);
}
