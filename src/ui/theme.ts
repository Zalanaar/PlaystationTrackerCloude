import { DEFAULT_THEME, LEGACY_THEME_ALIASES, THEMES, THEME_STORAGE_KEY, type ThemeId } from './tokens';

export function isThemeId(v: string | null | undefined): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

/** Сохранённое значение -> актуальная тема: старые id через LEGACY_THEME_ALIASES (activity -> ps5), неизвестное -> Night. */
export function normalizeTheme(raw: string | null | undefined): ThemeId {
  if (raw == null) return DEFAULT_THEME;
  if (Object.prototype.hasOwnProperty.call(LEGACY_THEME_ALIASES, raw)) return LEGACY_THEME_ALIASES[raw];
  return isThemeId(raw) ? raw : DEFAULT_THEME;
}

/** Месяц 1..12 по Europe/Moscow (для data-xmb-month в PS3). */
export function xmbMonth(now: Date = new Date()): number {
  const m = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Moscow', month: 'numeric' }).format(now));
  return m >= 1 && m <= 12 ? m : now.getUTCMonth() + 1;
}

/** Атрибут data-theme -> id темы (для Night атрибута нет). */
export function themeFromAttr(attr: string | null): ThemeId {
  const t = THEMES.find((x) => x.attr !== null && x.attr === attr);
  return t ? t.id : DEFAULT_THEME;
}

export function attrForTheme(id: ThemeId): string | null {
  return THEMES.find((t) => t.id === id)?.attr ?? null;
}

type Env = {
  root: { setAttribute(n: string, v: string): void; removeAttribute(n: string): void };
  /** Текущее время (для тестов); по умолчанию Date.now. */
  now?: Date;
  storage: { setItem(k: string, v: string): void } | null;
  setCookie: (c: string) => void;
};

/** Применяет тему и запоминает выбор (localStorage + cookie на год). */
export function applyTheme(id: ThemeId, env: Env): void {
  const attr = attrForTheme(id);
  if (attr) env.root.setAttribute('data-theme', attr);
  else env.root.removeAttribute('data-theme');
  env.root.setAttribute('data-xmb-month', String(xmbMonth(env.now)));
  try {
    env.storage?.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* приватный режим: выбор живёт до перезагрузки */
  }
  env.setCookie(`${THEME_STORAGE_KEY}=${id}; path=/; max-age=31536000; samesite=lax`);
}
