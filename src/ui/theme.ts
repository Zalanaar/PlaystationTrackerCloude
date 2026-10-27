import { DEFAULT_THEME, THEMES, THEME_STORAGE_KEY, type ThemeId } from './tokens';

export function isThemeId(v: string | null | undefined): v is ThemeId {
  return THEMES.some((t) => t.id === v);
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
  storage: { setItem(k: string, v: string): void } | null;
  setCookie: (c: string) => void;
};

/** Применяет тему и запоминает выбор (localStorage + cookie на год). */
export function applyTheme(id: ThemeId, env: Env): void {
  const attr = attrForTheme(id);
  if (attr) env.root.setAttribute('data-theme', attr);
  else env.root.removeAttribute('data-theme');
  try {
    env.storage?.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* приватный режим: выбор живёт до перезагрузки */
  }
  env.setCookie(`${THEME_STORAGE_KEY}=${id}; path=/; max-age=31536000; samesite=lax`);
}
