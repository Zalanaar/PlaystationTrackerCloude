import { describe, expect, it } from 'vitest';
import { applyTheme, attrForTheme, isThemeId, normalizeTheme, themeFromAttr, xmbMonth } from './theme';
import { THEMES } from './tokens';
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

/** Запускает inline-скрипт с подставленными localStorage/cookie, возвращает итоговое состояние. */
function runInit(saved: string | null, cookie = '', now = new Date('2026-10-28T12:00:00Z')) {
  const attrs = new Map<string, string>();
  const root = { setAttribute: (n: string, v: string) => void attrs.set(n, v), removeAttribute: (n: string) => void attrs.delete(n) };
  const store = new Map<string, string>();
  const doc = { documentElement: root, cookie };
  const writes: string[] = [];
  Object.defineProperty(doc, 'cookie', { get: () => cookie, set: (v: string) => void writes.push(v) });
  class FakeDate extends Date { constructor() { super(now.getTime()); } }
  const ls = { getItem: () => saved, setItem: (k: string, v: string) => void store.set(k, v) };
  new Function('localStorage', 'document', 'Date', themeInitScript)(ls, doc, FakeDate);
  return { theme: attrs.get('data-theme') ?? null, month: attrs.get('data-xmb-month') ?? null, store, writes };
}

describe('theme', () => {
  it('семь тем: Night без атрибута, остальные по id', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5']);
    expect(attrForTheme('night')).toBeNull();
    for (const t of ['graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'] as const) {
      expect(attrForTheme(t)).toBe(t);
      expect(themeFromAttr(t)).toBe(t);
      expect(isThemeId(t)).toBe(true);
    }
    expect(themeFromAttr(null)).toBe('night');
    expect(themeFromAttr('bogus')).toBe('night');
    expect(isThemeId('activity')).toBe(false);
    for (const old of ['wave', 'tiles', 'memory-card', 'crystal-towers', 'x']) expect(isThemeId(old)).toBe(false);
  });
  it('normalizeTheme: alias activity -> ps5, неизвестное -> Night', () => {
    expect(normalizeTheme('activity')).toBe('ps5');
    expect(normalizeTheme('ps3')).toBe('ps3');
    for (const v of ['wave', 'tiles', '', 'toString', '__proto__', null, undefined]) expect(normalizeTheme(v)).toBe('night');
  });
  it('xmbMonth считает месяц по Москве', () => {
    expect(xmbMonth(new Date('2026-01-31T21:30:00Z'))).toBe(2); // 00:30 МСК 1 февраля
    expect(xmbMonth(new Date('2026-12-31T20:59:00Z'))).toBe(12);
    expect(xmbMonth(new Date('2026-12-31T21:00:00Z'))).toBe(1);
  });
  it('applyTheme ставит атрибут и месяц, сохраняет выбор', () => {
    const { attrs, store, st, env } = makeEnv();
    applyTheme('ps3', { ...env, now: new Date('2026-05-10T10:00:00Z') });
    expect(attrs.get('data-theme')).toBe('ps3');
    expect(attrs.get('data-xmb-month')).toBe('5');
    expect(store.get('ps-theme')).toBe('ps3');
    expect(st.cookie).toContain('ps-theme=ps3');
    applyTheme('night', env);
    expect(attrs.has('data-theme')).toBe(false);
    expect(store.get('ps-theme')).toBe('night');
  });
  it('inline-скрипт: сохранённая актуальная тема применяется, месяц ставится', () => {
    for (const t of ['graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5']) expect(runInit(t).theme).toBe(t);
    expect(runInit('night').theme).toBeNull();
    expect(runInit('ps3', '', new Date('2026-12-31T21:00:00Z')).month).toBe('1');
  });
  it('inline-скрипт: activity -> ps5 и записывается обратно в localStorage и cookie', () => {
    const r = runInit('activity');
    expect(r.theme).toBe('ps5');
    expect(r.store.get('ps-theme')).toBe('ps5');
    expect(r.writes.join(';')).toContain('ps-theme=ps5');
  });
  it('inline-скрипт: без localStorage читает cookie, в т.ч. activity', () => {
    expect(runInit(null, 'a=1; ps-theme=ps2').theme).toBe('ps2');
    expect(runInit(null, 'ps-theme=activity').theme).toBe('ps5');
  });
  it('inline-скрипт: неизвестное и мусор -> Night', () => {
    for (const old of ['wave', 'tiles', 'memory-card', 'crystal-towers', '"><script>x', 'toString', null]) expect(runInit(old).theme).toBeNull();
  });
});
