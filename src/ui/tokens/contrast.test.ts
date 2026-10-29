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

// var(--x) и var(--x, запасное): запасное берётся, если --x нигде не задан (например --cover-tint у Night)
const resolveValue = (vars: Vars, v: string): string => {
  const ref = v.match(/^var\((--[\w-]+)\s*(?:,\s*(.+))?\)$/);
  if (!ref) return v;
  const next = vars[ref[1]] ?? base[ref[1]];
  if (next !== undefined) return resolveValue(vars, next);
  if (ref[2] !== undefined) return resolveValue(vars, ref[2].trim());
  throw new Error(`нет токена ${ref[1]}`);
};
const resolve = (vars: Vars, k: string): string => {
  const v = vars[k] ?? base[k];
  if (v === undefined) throw new Error(`нет токена ${k}`);
  return resolveValue(vars, v);
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
    expect(decorCss).toMatch(/\[data-theme="ps5"\] \.ps-app::before \{[^}]*blur\(64px\)[^}]*opacity: \.28\s*;/);
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
    for (const k of [...STATUSES.filter((s) => s !== '--st-playing'), ...SEMANTIC, '--text', '--text-2', '--text-3', '--rar-0', '--rar-1', '--rar-2', '--plat-text', '--platinum', '--accent'])
      it(`${k} на тёмном фоне >= 4.5`, () => expect(ratio(sv(k), dark)).toBeGreaterThanOrEqual(4.5));
    it('--st-playing берёт акцент светлой палитры', () => expect(ratio(sv('--st-playing'), dark)).toBeGreaterThanOrEqual(4.5));
    it('--accent-ink на --accent >= 7', () => expect(ratio(sv('--accent-ink'), sv('--accent'))).toBeGreaterThanOrEqual(7));
    // Сцена Итогов не зависит от светлых базовых токенов PS1: фон и поверхности тёмные
    for (const k of ['--bg', '--surface', '--surface-2', '--surface-3'])
      it(`сцена: ${k} тёмный (яркость <= 0.06)`, () => expect(L(sv(k))).toBeLessThanOrEqual(0.06));
    it('сцена: текст --text на --surface-3 >= 4.5', () => expect(ratio(sv('--text'), sv('--surface-3'))).toBeGreaterThanOrEqual(4.5));
  });

  // ---- Фаза 9.1 / 15 ----
  // --on-scrim: текст на затемнённом арте. Тёмный скрим во всех темах (в том числе светлой PS1), белая обложка арта = худший случай
  describe('--on-scrim на --cover-scrim', () => {
    const alphas = [...base['--cover-scrim'].matchAll(/rgba\(0,\s*0,\s*0,\s*([\d.]+)\)/g)].map((m) => +m[1]);
    const white = '#ffffff';
    it('скрим: три остановки .88 / .6 / 0', () => expect(alphas).toEqual([0.88, 0.6, 0]));
    it('--on-scrim = белый и не переопределяется темами', () => {
      expect(base['--on-scrim']).toBe('#ffffff');
      for (const t of IDS) expect(themes[t]['--on-scrim']).toBeUndefined();
    });
    it('--scrim-text = --on-scrim, --scrim-edge задан', () => {
      expect(base['--scrim-text']).toBe('var(--on-scrim)');
      expect(base['--scrim-edge']).toMatch(/^rgba\(/);
    });
    // Нижняя остановка (.88): там лежит основной текст. Средняя (.6): верхний предел текста по спеке, порог 5.5 (7 при .6 недостижим на белом арте)
    it('низ скрима (.88) над белым артом: >= 7', () =>
      expect(ratio(white, over('#000000', alphas[0], white))).toBeGreaterThanOrEqual(7));
    it('середина скрима (.6) над белым артом: >= 5.5', () =>
      expect(ratio(white, over('#000000', alphas[1], white))).toBeGreaterThanOrEqual(5.5));
  });

  for (const t of IDS)
    describe(`${t}: токены фаз 9.1 и 15`, () => {
      const bgs = ['--bg', '--surface', '--surface-2'];
      // Карта активности: пять ступеней от --surface-3 (0) к --accent (4); color-mix(srgb) = смешивание accent a% с surface-3
      const s3 = get(t, '--surface-3');
      const ac = get(t, '--accent');
      const heat = [s3, over(ac, 0.28, s3), over(ac, 0.5, s3), over(ac, 0.75, s3), ac];
      it('--heat-*: формулы в tokens.css', () => {
        expect(base['--heat-0']).toBe('var(--surface-3)');
        expect(base['--heat-1']).toContain('var(--accent) 28%, var(--surface-3)');
        expect(base['--heat-2']).toContain('var(--accent) 50%, var(--surface-3)');
        expect(base['--heat-3']).toContain('var(--accent) 75%, var(--surface-3)');
        expect(base['--heat-4']).toBe('var(--accent)');
        for (const n of [0, 1, 2, 3, 4]) expect(themes[t][`--heat-${n}`]).toBeUndefined();
      });
      for (let n = 0; n < 4; n++)
        it(`--heat-${n} и --heat-${n + 1} различимы >= 1.3`, () => expect(ratio(heat[n], heat[n + 1])).toBeGreaterThanOrEqual(1.3));
      it('--heat-0 и --heat-4 >= 3', () => expect(ratio(heat[0], heat[4])).toBeGreaterThanOrEqual(3));
      for (const bg of ['--bg', '--surface'])
        it(`--heat-4 на ${bg} >= 3`, () => expect(ratio(heat[4], get(t, bg))).toBeGreaterThanOrEqual(3));

      // Платиновая подложка: худшая точка = 0% градиента (plat-2 с силой --plat-wash-a) и вторая остановка (plat-1 с .35 силы)
      // Карточка лежит на --bg, строка на --surface (hover строки не меняет фон под подложкой, см. docs)
      const a = parseFloat(resolve(merged(t), '--plat-wash-a')) / 100;
      for (const bg of ['--bg', '--surface']) {
        const stops = [over(get(t, '--plat-2'), a, get(t, bg)), over(get(t, '--plat-1'), a * 0.35, get(t, bg))];
        stops.forEach((wash, i) => {
          it(`подложка (остановка ${i + 1}) на ${bg}: --text >= 7`, () => expect(ratio(get(t, '--text'), wash)).toBeGreaterThanOrEqual(7));
          it(`подложка (остановка ${i + 1}) на ${bg}: --text-3 >= 4.5`, () => expect(ratio(get(t, '--text-3'), wash)).toBeGreaterThanOrEqual(4.5));
        });
      }
      it('--plat-wash-a задан темой и не больше 16%', () => {
        expect(themes[t]['--plat-wash-a']).toMatch(/^\d+%$/);
        expect(a).toBeLessThanOrEqual(0.16);
      });

      for (const bg of bgs)
        it(`--platinum на ${bg} >= 3`, () => expect(ratio(get(t, '--platinum'), get(t, bg))).toBeGreaterThanOrEqual(3));
      it('--platinum = --plat-text', () => expect(get(t, '--platinum')).toBe(get(t, '--plat-text')));

      // --tint: цвет обложки только у Night
      it(t === 'night' ? '--tint учитывает --cover-tint' : '--tint игнорирует --cover-tint', () => {
        if (t === 'night') expect(themes.night['--tint']).toBe('var(--cover-tint, #b99cff)');
        else expect(themes[t]['--tint']).not.toContain('cover-tint');
      });
    });

  // ---- Фаза 12: роадмап (спека, п.1). --rm-conflict-bg = --danger 22% поверх --surface-2; проверяем и поверх --surface (карточка на панели)
  describe('роадмап: токены --rm-*', () => {
    it('токены заданы в tokens.css и не переопределяются темами', () => {
      for (const k of ['--rm-bar-h', '--rm-axis-h', '--rm-label-w', '--rm-row-h', '--rm-bar-alt', '--rm-conflict-bg', '--rm-conflict-hatch']) {
        expect(base[k], k).toBeTruthy();
        for (const t of IDS) expect(themes[t][k], `${t} ${k}`).toBeUndefined();
      }
      expect(base['--rm-conflict-bg']).toBe('color-mix(in srgb, var(--danger) 22%, var(--surface-2))');
    });
    for (const t of IDS)
      describe(`${t}: роадмап`, () => {
        const danger = get(t, '--danger');
        for (const under of ['--surface', '--surface-2']) {
          const bg = over(danger, 0.22, get(t, under));
          it(`--text на --rm-conflict-bg (поверх ${under}) >= 4.5`, () => expect(ratio(get(t, '--text'), bg)).toBeGreaterThanOrEqual(4.5));
          it(`--danger на --rm-conflict-bg (поверх ${under}) >= 3`, () => expect(ratio(danger, bg)).toBeGreaterThanOrEqual(3));
        }
        for (const bg of ['--surface', '--bg'])
          it(`--danger (контур, пунктир) на ${bg} >= 3`, () => expect(ratio(danger, get(t, bg))).toBeGreaterThanOrEqual(3));
        it('--text на --rm-bar-alt (второй тон полос очереди) >= 4.5', () => expect(ratio(get(t, '--text'), over(get(t, '--text'), 0.1, get(t, '--surface-3')))).toBeGreaterThanOrEqual(4.5));
        it('--rm-bar-alt отличим от --surface-3 (>= 1.05)', () => expect(ratio(over(get(t, '--text'), 0.1, get(t, '--surface-3')), get(t, '--surface-3'))).toBeGreaterThanOrEqual(1.05));
        it('--text на --surface-3 (подпись полосы очереди) >= 4.5', () => expect(ratio(get(t, '--text'), get(t, '--surface-3'))).toBeGreaterThanOrEqual(4.5));
        it('--accent-ink на --accent (подпись релизной полосы) >= 7', () => expect(ratio(get(t, '--accent-ink'), get(t, '--accent'))).toBeGreaterThanOrEqual(7));
      });
  });

  it('Night: запасное значение --tint в decor.css совпадает с themes.css', () => {
    expect(decorCss).toContain('--tint: var(--cover-tint, #b99cff);');
    expect(decorCss).toContain(`--tint-glow: ${base['--tint-glow']};`);
  });
  it('--cover-tint встречается только в Night и в его области в decor.css', () => {
    expect(Object.keys(themes).filter((t) => (themes[t]['--tint'] ?? '').includes('cover-tint'))).toEqual(['night']);
    expect(themesCss.match(/cover-tint/g)?.length).toBe(1);
  });
  it('PS5: чип «Платина» не перекрыт белой заливкой общего чипа', () => {
    expect(decorCss).toContain('[data-theme="ps5"] .ps-chip[aria-pressed="true"]:not(.ps-filterchip--plat)');
    expect(decorCss).toMatch(/\[data-theme="ps5"\] \.ps-filterchip--plat\[aria-pressed="true"\] \{[^}]*var\(--plat-fill\)/);
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
