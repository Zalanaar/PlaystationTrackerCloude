import { THEME_COLORS, type ThemeId } from './tokens';

/** Минимальный срез Document, нужный для синхронизации мета-тегов (упрощает тест без DOM). */
type MetaEl = { content: string; removeAttribute(n: string): void; getAttribute(n: string): string | null };
type Doc = {
  querySelectorAll(sel: string): ArrayLike<MetaEl>;
  head: { appendChild(el: never): unknown };
  createElement(tag: 'meta'): MetaEl & { name: string };
};

/** Стиль статус-бара iOS: translucent = полоса под часами красится фоном страницы (--bg), а не фиксированным цветом. */
export const APPLE_STATUS_BAR_STYLE = 'black-translucent';

/**
 * theme-color = --bg темы. Все теги (в том числе с media prefers-color-scheme) получают один цвет и теряют media,
 * иначе браузер выберет тег по системной теме и проигнорирует выбор пользователя. Нет ни одного тега -> создаём.
 * Возвращает цвет.
 */
export function syncThemeMeta(doc: Doc, id: ThemeId): string {
  const color = THEME_COLORS[id];
  const metas = Array.from(doc.querySelectorAll('meta[name="theme-color"]'));
  if (metas.length === 0) {
    const m = doc.createElement('meta');
    m.name = 'theme-color';
    m.content = color;
    doc.head.appendChild(m as never);
  }
  for (const m of metas) {
    m.content = color;
    if (m.getAttribute('media') !== null) m.removeAttribute('media');
  }
  for (const m of Array.from(doc.querySelectorAll('meta[name="apple-mobile-web-app-status-bar-style"]'))) m.content = APPLE_STATUS_BAR_STYLE;
  return color;
}
