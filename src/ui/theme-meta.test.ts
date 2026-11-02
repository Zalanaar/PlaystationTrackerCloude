import { describe, expect, it } from 'vitest';
import { syncThemeMeta, APPLE_STATUS_BAR_STYLE } from './theme-meta';
import { THEMES, THEME_COLORS } from './tokens';
import { themeInitScript } from './theme-script';
import { readFileSync } from 'node:fs';

type M = { content: string; media: string | null; name?: string; removeAttribute(n: string): void; getAttribute(n: string): string | null };
const meta = (content: string, media: string | null = null): M => ({
  content, media, removeAttribute(n) { if (n === 'media') this.media = null; }, getAttribute(n) { return n === 'media' ? this.media : null; },
});

function doc(theme: M[], apple: M[] = []) {
  const created: M[] = [];
  return {
    created,
    querySelectorAll: (sel: string) => (sel.includes('theme-color') ? theme : apple),
    head: { appendChild: (el: M) => { theme.push(el); created.push(el); } },
    createElement: () => meta('') as M & { name: string },
  };
}

describe('syncThemeMeta', () => {
  it('красит все теги и снимает media у дублей', () => {
    const a = meta('#000', '(prefers-color-scheme: dark)');
    const b = meta('#fff', '(prefers-color-scheme: light)');
    const color = syncThemeMeta(doc([a, b]) as never, 'ps1');
    expect(color).toBe(THEME_COLORS.ps1);
    expect([a.content, b.content]).toEqual([THEME_COLORS.ps1, THEME_COLORS.ps1]);
    expect([a.media, b.media]).toEqual([null, null]);
  });
  it('создаёт тег, если его нет', () => {
    const d = doc([]);
    syncThemeMeta(d as never, 'ps4');
    expect(d.created).toHaveLength(1);
    expect(d.created[0].content).toBe(THEME_COLORS.ps4);
  });
  it('apple status-bar-style = translucent (полоса красится фоном страницы)', () => {
    const ap = meta('black');
    syncThemeMeta(doc([meta('#000')], [ap]) as never, 'night');
    expect(ap.content).toBe(APPLE_STATUS_BAR_STYLE);
    expect(APPLE_STATUS_BAR_STYLE).toBe('black-translucent');
  });
  it('THEME_COLORS совпадает с --statusbar-bg (иначе --bg) в themes.css для всех тем', () => {
    const css = readFileSync('src/ui/tokens/themes.css', 'utf8');
    for (const t of THEMES) {
      const sel = t.attr ? `[data-theme="${t.attr}"]` : ':root';
      const i = css.indexOf(sel);
      expect(i, sel).toBeGreaterThanOrEqual(0);
      const block = css.slice(i, css.indexOf('\n}', i));
      const m = (t.attr ? block.match(/--statusbar-bg:\s*(#[0-9a-fA-F]{6})/) : null) ?? css.slice(i).match(/--bg:\s*(#[0-9a-fA-F]{6})/);
      expect(m?.[1].toLowerCase(), t.id).toBe(THEME_COLORS[t.id].toLowerCase());
    }
  });
  it('inline-скрипт темы обновляет theme-color для каждой темы', () => {
    for (const t of THEMES) expect(themeInitScript).toContain(THEME_COLORS[t.id]);
    expect(themeInitScript).toContain('meta[name="theme-color"]');
  });
});
