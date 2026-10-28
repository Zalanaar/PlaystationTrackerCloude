// Цвет акцента из обложки «Играю» (спека Фазы 15 п.12). Чистые функции, без DOM.
// Работает только в Night: в остальных темах inline-значение игнорируется CSS (phase15.css), поэтому пороги считаются на токенах Night.
import type { CSSProperties } from 'react';

/** `--accent-ink` Night: текст на заливке акцента (кнопки primary). */
export const NIGHT_INK = '#14101f';
/** `--surface-2` Night: плитка, на которой лежат бары и фигуры. */
export const NIGHT_SURFACE_2 = '#202333';

const HEX = /^#[0-9a-f]{6}$/i;
const MIN_SATURATION = 0.15;
const SAT_RANGE = [0.45, 0.85] as const;
const LIGHT_RANGE = [0.70, 0.82] as const;
const LIGHT_MAX = 0.88;
const MIN_INK_CONTRAST = 7;
const MIN_SURFACE_CONTRAST = 4.5;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex: string): number {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(parseInt(hex.slice(1, 3), 16)) + 0.7152 * f(parseInt(hex.slice(3, 5), 16)) + 0.0722 * f(parseInt(hex.slice(5, 7), 16));
}

/** Контраст WCAG двух `#rrggbb`. */
export function contrastRatio(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Нормализует цвет обложки так, чтобы он читался как акцент Night: S в [0.45; 0.85], L в [0.70; 0.82],
 * контраст с `ink` не ниже 7 и с `surface` не ниже 4.5. Не прошло: L растёт шагом 0.02 до 0.88, дальше `null`.
 * `null` = серый, чёрный, белый, невалидное значение или не удалось добиться контраста: берём акцент темы.
 */
export function safeTint(hex: string | null | undefined, ink: string = NIGHT_INK, surface: string = NIGHT_SURFACE_2): string | null {
  if (typeof hex !== 'string' || !HEX.test(hex)) return null;
  const [h, s0, l0] = hexToHsl(hex.toLowerCase());
  if (s0 < MIN_SATURATION) return null;
  const s = clamp(s0, SAT_RANGE);
  const start = Math.round(clamp(l0, LIGHT_RANGE) * 100);
  for (let l = start; l <= LIGHT_MAX * 100; l += 2) {
    const c = hslToHex(h, s, l / 100);
    if (contrastRatio(c, ink) >= MIN_INK_CONTRAST && contrastRatio(c, surface) >= MIN_SURFACE_CONTRAST) return c;
  }
  return null;
}

/**
 * Inline `--cover-tint` для hero «Играю», мини-карточек и окна игры. Пересчёт --tint/--accent в этих областях и только в Night
 * делает decor.css; в других темах значение игнорируется. Нет годного цвета: пусто (работает акцент темы).
 */
export function tintStyle(tint: string | null | undefined): CSSProperties | undefined {
  const c = safeTint(tint);
  return c ? ({ '--cover-tint': c } as CSSProperties) : undefined;
}
