import { describe, expect, it } from 'vitest';
import { applyTheme, attrForTheme, isThemeId, themeFromAttr } from './theme';
import { themeInitScript } from './theme-script';

function makeEnv() {
  const attrs = new Map<string, string>();
  const store = new Map<string, string>();
  const st = { cookie: '' };
  const env = {
    root: { setAttribute: (n: string, v: string) => void attrs.set(n, v), removeAttribute: (n: string) => void attrs.delete(n) },
    storage: { setItem: (k: string, v: string) => void store.set(k, v) },
    setCookie: (c: string) => { st.cookie = c; },
  };
  return { attrs, store, st, env };
}

/** Запускает inline-скрипт с подставленным localStorage и root, возвращает итоговый data-theme. */
function runInit(saved: string | null): string | null {
  const attrs = new Map<string, string>();
  const root = { setAttribute: (n: string, v: string) => void attrs.set(n, v), removeAttribute: (n: string) => void attrs.delete(n) };
  const fn = new Function('localStorage', 'document', themeInitScript);
  fn({ getItem: () => saved }, { documentElement: root });
  return attrs.get('data-theme') ?? null;
}

describe('theme', () => {
  it('три темы: Night без атрибута, Graphite, Activity', () => {
    expect(attrForTheme('night')).toBeNull();
    expect(attrForTheme('graphite')).toBe('graphite');
    expect(attrForTheme('activity')).toBe('activity');
    expect(themeFromAttr(null)).toBe('night');
    expect(themeFromAttr('graphite')).toBe('graphite');
    expect(themeFromAttr('bogus')).toBe('night');
    expect(themeFromAttr('wave')).toBe('night');
    expect(isThemeId('activity')).toBe(true);
    for (const old of ['wave', 'tiles', 'memory-card', 'crystal-towers', 'x']) expect(isThemeId(old)).toBe(false);
  });
  it('applyTheme ставит атрибут, сохраняет выбор', () => {
    const { attrs, store, st, env } = makeEnv();
    applyTheme('graphite', env);
    expect(attrs.get('data-theme')).toBe('graphite');
    expect(store.get('ps-theme')).toBe('graphite');
    expect(st.cookie).toContain('ps-theme=graphite');
    applyTheme('night', env);
    expect(attrs.has('data-theme')).toBe(false);
    expect(store.get('ps-theme')).toBe('night');
  });
  it('сохранённая старая тема сбрасывается на Night, актуальная применяется', () => {
    for (const old of ['wave', 'tiles', 'memory-card', 'crystal-towers', '"><script>x', null]) expect(runInit(old)).toBeNull();
    expect(runInit('graphite')).toBe('graphite');
    expect(runInit('activity')).toBe('activity');
    expect(runInit('night')).toBeNull();
  });
});
