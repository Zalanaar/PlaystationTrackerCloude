import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Проверка контраста по themes.css/tokens.css. Правила: docs/design-system.md §6.
const themesCss = readFileSync(new URL('./themes.css', import.meta.url), 'utf8');
const tokensCss = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

type Theme = Record<string, string>;
const themes: Record<string, Theme> = {};
for (const m of themesCss.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  const vars: Theme = {};
  for (const v of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[v[1]] = v[2].trim();
  const names = m[1].match(/data-theme="([\w-]+)"/g)?.map((s) => s.slice(12, -1)) ?? [];
  if (m[1].includes(':root')) names.push('night');
  for (const n of new Set(names)) themes[n] = { ...(themes[n] ?? {}), ...vars };
}
const base: Theme = {};
for (const v of tokensCss.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) base[v[1]] = v[2];

const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const L = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
export const ratio = (a: string, b: string) => {
  const [x, y] = [L(a), L(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const get = (t: string, k: string): string => {
  const v = themes[t][k] ?? base[k];
  return v?.startsWith('var(') ? get(t, v.slice(4, -1)) : v;
};
/** Смешивание цвета fg с альфой a поверх bg (оба #rrggbb), результат #rrggbb. */
const over = (fg: string, a: number, bg: string) => {
  const f = rgb(fg), b = rgb(bg);
  return '#' + f.map((c, i) => Math.round(c * a + b[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
};

const NAMES = ['night', 'graphite', 'activity'];
const STATUSES = ['--st-completed', '--st-backlog', '--st-dropped', '--st-shelved'];

describe('контраст тем', () => {
  it('найдены ровно 3 темы', () => expect(Object.keys(themes).sort()).toEqual([...NAMES].sort()));
  for (const t of NAMES) {
    describe(t, () => {
      for (const fg of ['--text', '--text-2', '--text-3'])
        for (const bg of ['--bg', '--surface', '--surface-2'])
          it(`${fg} на ${bg} >= 4.5`, () => expect(ratio(get(t, fg), get(t, bg))).toBeGreaterThanOrEqual(4.5));
      it('--accent-ink на --accent >= 7', () => expect(ratio(get(t, '--accent-ink'), get(t, '--accent'))).toBeGreaterThanOrEqual(7));
      for (const bg of ['--bg', '--surface', '--surface-2'])
        it(`--accent на ${bg} >= 4.5`, () => expect(ratio(get(t, '--accent'), get(t, bg))).toBeGreaterThanOrEqual(4.5));
      for (const st of STATUSES)
        for (const bg of ['--bg', '--surface', '--surface-2'])
          it(`${st} на ${bg} >= 4.5`, () => expect(ratio(get(t, st), get(t, bg))).toBeGreaterThanOrEqual(4.5));
    });
  }
  // Текст и фигуры на обложке лежат только внутри чипа --on-cover-bg (rgba(8,9,14,.78)). Худший случай: белая обложка.
  describe('чипы на обложке', () => {
    const chip = over('#080910', 0.78, '#ffffff');
    it('белый текст на чипе поверх белой обложки >= 7', () => expect(ratio('#ffffff', chip)).toBeGreaterThanOrEqual(7));
    for (const st of STATUSES)
      it(`${st} (фигура) на чипе поверх белой обложки >= 3`, () => expect(ratio(base[st], chip)).toBeGreaterThanOrEqual(3));
  });
});
