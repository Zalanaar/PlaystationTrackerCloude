import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEGACY_THEME_ALIASES, THEMES } from './index';

// Проверка контраста по themes.css/tokens.css. Правила и пороги: docs/design-system.md §6 и §2.4.
const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const themesCss = read('./themes.css');
const tokensCss = read('./tokens.css');
const decorCss = read('./decor.css');
const tailwindTs = read('./tailwind.tokens.ts');

type Vars = Record<string, string>;
const parseVars = (body: string): Vars => {
  const vars: Vars = {};
  for (const v of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[v[1]] = v[2].trim();
  return vars;
};

const themes: Record<string, Vars> = {};
const months: Record<number, Vars> = {};
let story: Vars = {};
for (const m of themesCss.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  const sel = m[1].trim().replace(/\s+/g, ' ');
  const vars = parseVars(m[2]);
  let r: RegExpMatchArray | null;
  if ((r = sel.match(/^\[data-theme="([\w-]+)"\]$/))) themes[r[1]] = { ...(themes[r[1]] ?? {}), ...vars };
  else if (/^:root, \[data-theme="night"\]$/.test(sel)) themes.night = { ...(themes.night ?? {}), ...vars };
  else if ((r = sel.match(/^\[data-theme="ps3"\]\[data-xmb-month="(\d+)"\]$/))) months[Number(r[1])] = vars;
  else if (sel === '[data-theme="ps1"] .ps-story') story = vars;
}
// Базовые токены: первый блок :root в tokens.css
const base: Vars = parseVars(tokensCss.match(/:root\s*\{([^}]*)\}/)![1]);

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
/** Смешивание цвета fg с альфой a поверх bg (оба #rrggbb), результат #rrggbb. */
const over = (fg: string, a: number, bg: string) => {
  const f = rgb(fg), b = rgb(bg);
  return '#' + f.map((c, i) => Math.round(c * a + b[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
};
const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');
/** '#rrggbb' или 'rgba(r, g, b, a)' -> { hex, a } */
const parseColor = (v: string): { hex: string; a: number } => {
  if (v.startsWith('#')) return { hex: v, a: 1 };
  const m = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (!m) throw new Error(`не цвет: ${v}`);
  return { hex: '#' + hex2(+m[1]) + hex2(+m[2]) + hex2(+m[3]), a: m[4] === undefined ? 1 : +m[4] };
};

const resolve = (vars: Vars, k: string): string => {
  const v = vars[k] ?? base[k];
  if (v === undefined) throw new Error(`нет токена ${k}`);
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  return ref ? resolve(vars, ref[1]) : v;
};
const merged = (t: string): Vars => ({ ...base, ...themes[t] });
const get = (t: string, k: string): string => parseColor(resolve(merged(t), k)).hex;

const IDS: string[] = THEMES.map((t) => t.id);
const BGS = ['--bg', '--surface', '--surface-2'];
const STATUSES = ['--st-playing', '--st-completed', '--st-backlog', '--st-dropped', '--st-shelved', '--st-service'];
const SEMANTIC = ['--success', '--warning', '--danger'];
const R_CHIP: Record<string, string> = { night: '999px', graphite: '999px', ps1: '4px', ps2: '4px', ps3: '999px', ps4: '4px', ps5: '999px' };

describe('состав тем', () => {
  it('в themes.css ровно 7 тем из THEMES', () => expect(Object.keys(themes).sort()).toEqual([...IDS].sort()));
  it('THEMES: 7 пунктов, Night первый без атрибута, ps1..ps5', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5']);
    expect(THEMES[0].attr).toBeNull();
  });
  it('Activity удалена из токенов и декора', () => {
    for (const css of [themesCss, tokensCss, decorCss, tailwindTs]) expect(css).not.toMatch(/activity/i);
  });
  it('alias activity -> ps5', () => {
    expect(LEGACY_THEME_ALIASES.activity).toBe('ps5');
    expect(IDS).toContain(LEGACY_THEME_ALIASES.activity);
  });
  const required = Object.keys(themes.night);
  for (const t of IDS)
    it(`${t}: заданы все токены темы`, () => {
      const missing = required.filter((k) => !(k in themes[t]) && !['--bg-image', '--page-art'].includes(k));
      expect(missing).toEqual([]);
    });
  for (const t of IDS) it(`${t}: --r-chip = ${R_CHIP[t]}`, () => expect(themes[t]['--r-chip']).toBe(R_CHIP[t]));
  it('--r-chip имеет дефолт в tokens.css', () => expect(base['--r-chip']).toBe('999px'));
  it('PS3: заданы 12 пар градиента', () => {
    expect(Object.keys(months).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const m of Object.values(months)) expect(Object.keys(m).sort()).toEqual(['--xmb-a', '--xmb-b']);
  });
  it('PS5: арт opacity не больше .28 и затемнение не меньше .45', () => {
    expect(decorCss).toMatch(/blur\(64px\)[^;]*;[^;]*opacity: \.28/);
    expect(decorCss).toMatch(/rgba\(10, 10, 12, \.45\)/);
  });
});

describe('контраст тем', () => {
  for (const t of IDS) {
    describe(t, () => {
      for (const fg of ['--text', '--text-2', '--text-3'])
        for (const bg of BGS)
          it(`${fg} на ${bg} >= 4.5`, () => expect(ratio(get(t, fg), get(t, bg))).toBeGreaterThanOrEqual(4.5));
      it('--accent-ink на --accent >= 7', () => expect(ratio(get(t, '--accent-ink'), get(t, '--accent'))).toBeGreaterThanOrEqual(7));
      for (const bg of BGS)
        it(`--accent на ${bg} >= 4.5`, () => expect(ratio(get(t, '--accent'), get(t, bg))).toBeGreaterThanOrEqual(4.5));
      for (const st of [...STATUSES, ...SEMANTIC])
        for (const bg of BGS)
          it(`${st} на ${bg} >= 4.5`, () => expect(ratio(get(t, st), get(t, bg))).toBeGreaterThanOrEqual(4.5));
      // Трофейные цвета: иконки (не текст), порог для нетекстовых элементов 3
      for (const c of ['--gold', '--silver', '--bronze'])
        for (const bg of BGS)
          it(`${c} на ${bg} >= 3`, () => expect(ratio(get(t, c), get(t, bg))).toBeGreaterThanOrEqual(3));
      // Платина (design-system §4.14): текст/иконка --plat-text >= 7 на поверхностях, знак --plat-ink на заливке >= 7
      for (const bg of BGS)
        it(`--plat-text на ${bg} >= 7`, () => expect(ratio(get(t, '--plat-text'), get(t, bg))).toBeGreaterThanOrEqual(7));
      for (const f of ['--plat-1', '--plat-2'])
        it(`--plat-ink на ${f} >= 7`, () => expect(ratio(get(t, '--plat-ink'), get(t, f))).toBeGreaterThanOrEqual(7));
      // Редкость (§4.15); --rar-3 = --text-2, покрыт выше
      for (const r of ['--rar-0', '--rar-1', '--rar-2'])
        for (const bg of ['--surface', '--surface-2'])
          it(`${r} на ${bg} >= 4.5`, () => expect(ratio(get(t, r), get(t, bg))).toBeGreaterThanOrEqual(4.5));
    });
  }

  // Чипы поверх обложек: --on-cover-* из токенов темы. Худшие обложки: белая и чёрная.
  describe('чипы на обложке', () => {
    for (const t of IDS) {
      const c = parseColor(resolve(merged(t), '--on-cover-bg'));
      for (const cover of ['#ffffff', '#000000']) {
        const chip = over(c.hex, c.a, cover);
        const name = `${t} на обложке ${cover}`;
        it(`${name}: --on-cover-text на чипе >= 7`, () => expect(ratio(get(t, '--on-cover-text'), chip)).toBeGreaterThanOrEqual(7));
        it(`${name}: --plat-text на чипе >= 7`, () => expect(ratio(get(t, '--plat-text'), chip)).toBeGreaterThanOrEqual(7));
        for (const st of STATUSES)
          it(`${name}: ${st} (фигура) на чипе >= 3`, () => expect(ratio(get(t, st), chip)).toBeGreaterThanOrEqual(3));
      }
    }
  });

  // Итоги в PS1 всегда тёмные: палитра внутри .ps-story проверяется на тёмной подложке Night
  describe('ps1: .ps-story (тёмный контекст)', () => {
    const dark = get('night', '--bg');
    const sv = (k: string) => parseColor(story[k]).hex;
    it('палитра истории задана', () => expect(Object.keys(story).length).toBeGreaterThan(15));
    for (const k of [...STATUSES.filter((s) => s !== '--st-playing'), ...SEMANTIC, '--text', '--text-2', '--text-3', '--rar-0', '--rar-1', '--rar-2', '--plat-text'])
      it(`${k} на тёмном фоне >= 4.5`, () => expect(ratio(sv(k), dark)).toBeGreaterThanOrEqual(4.5));
    it('--st-playing берёт акцент светлой палитры', () => expect(ratio(sv('--st-playing'), dark)).toBeGreaterThanOrEqual(4.5));
  });

  // PS3: 12 пар градиента. Текст --text-3 на верхнем цвете и на среднем цвете под волной (волна + линии, худший случай белый .11)
  describe('ps3: градиент по месяцам', () => {
    for (let m = 1; m <= 12; m++)
      for (const fg of ['--text-2', '--text-3']) {
        it(`месяц ${m}: ${fg} на --xmb-a >= 4.5`, () =>
          expect(ratio(get('ps3', fg), parseColor(months[m]['--xmb-a']).hex)).toBeGreaterThanOrEqual(4.5));
        it(`месяц ${m}: ${fg} на --xmb-b под волной >= 4.5`, () =>
          expect(ratio(get('ps3', fg), over('#ffffff', 0.11, parseColor(months[m]['--xmb-b']).hex))).toBeGreaterThanOrEqual(4.5));
      }
  });
});
