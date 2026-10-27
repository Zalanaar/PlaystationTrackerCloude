import { describe, expect, it } from 'vitest';
import { applyTheme, attrForTheme, isThemeId, themeFromAttr } from './theme';

describe('theme', () => {
  it('соответствие id и атрибута, Dark = graphite', () => {
    expect(attrForTheme('night')).toBeNull();
    expect(attrForTheme('graphite')).toBe('graphite');
    expect(themeFromAttr(null)).toBe('night');
    expect(themeFromAttr('graphite')).toBe('graphite');
    expect(themeFromAttr('bogus')).toBe('night');
    expect(isThemeId('wave')).toBe(true);
    expect(isThemeId('x')).toBe(false);
  });
  it('applyTheme ставит атрибут, сохраняет выбор', () => {
    const attrs = new Map<string, string>();
    const store = new Map<string, string>();
    let cookie = '';
    const env = {
      root: { setAttribute: (n: string, v: string) => void attrs.set(n, v), removeAttribute: (n: string) => void attrs.delete(n) },
      storage: { setItem: (k: string, v: string) => void store.set(k, v) },
      setCookie: (c: string) => { cookie = c; },
    };
    applyTheme('tiles', env);
    expect(attrs.get('data-theme')).toBe('tiles');
    expect(store.get('ps-theme')).toBe('tiles');
    expect(cookie).toContain('ps-theme=tiles');
    applyTheme('night', env);
    expect(attrs.has('data-theme')).toBe(false);
    expect(store.get('ps-theme')).toBe('night');
  });
});
