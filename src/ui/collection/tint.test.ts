import { describe, expect, it } from 'vitest';
import { NIGHT_INK, NIGHT_SURFACE_2, contrastRatio, safeTint, tintStyle } from './tint';

describe('safeTint', () => {
  const colors = { красный: '#d6342f', синий: '#2b5fd9', жёлтый: '#f2c230', зелёный: '#1e8a4c', фиолетовый: '#7a3fd0', тёмно_синий: '#0a1f6e', бледно_розовый: '#f0d0d8' };

  it.each(Object.entries(colors))('%s: результат проходит пороги контраста', (_n, hex) => {
    const c = safeTint(hex);
    expect(c).not.toBeNull();
    expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastRatio(c as string, NIGHT_INK)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(c as string, NIGHT_SURFACE_2)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([['серый', '#808080'], ['чёрный', '#000000'], ['белый', '#ffffff'], ['почти серый', '#8a8689']])('%s -> null (откат на акцент темы)', (_n, hex) => {
    expect(safeTint(hex)).toBeNull();
  });

  it.each([[null], [undefined], [''], ['oops'], ['#fff'], ['#12345g'], ['d6342f']])('невалидное %s -> null', (v) => {
    expect(safeTint(v as string | null | undefined)).toBeNull();
  });

  it('осветляет тёмный цвет и не затемняет светлый выше границ', () => {
    const dark = safeTint('#0a1f6e') as string;
    const light = safeTint('#f0d0d8') as string;
    const lum = (hex: string) => contrastRatio(hex, '#000000');
    expect(lum(dark)).toBeGreaterThan(lum('#0a1f6e'));
    expect(lum(light)).toBeLessThan(lum('#f0d0d8') + 0.01);
  });

  it('оттенок сохраняется', () => {
    const c = safeTint('#d6342f') as string;
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it('регистр hex не важен', () => {
    expect(safeTint('#D6342F')).toBe(safeTint('#d6342f'));
  });

  it('невыполнимые пороги дают null, а не небезопасный цвет', () => {
    expect(safeTint('#d6342f', '#ffffff', NIGHT_SURFACE_2)).toBeNull();
  });
});

describe('tintStyle', () => {
  it('ставит --cover-tint для годного цвета', () => {
    const a = tintStyle('#2b5fd9') as Record<string, string>;
    expect(a['--cover-tint']).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('нет стиля для серого и null (работает акцент темы)', () => {
    expect(tintStyle('#808080')).toBeUndefined();
    expect(tintStyle(null)).toBeUndefined();
    expect(tintStyle(undefined)).toBeUndefined();
  });
});
