// Цвет акцента из обложки (контракт 15.2). Чистая часть: выбор цвета из пикселей. Декодирование: decode.ts.

export const TINT_SIZE = 32;
/** Минимальная доля пикселей победившего сектора оттенка. */
export const MIN_SHARE = 0.05;
const MIN_SAT = 0.3;
const MIN_VAL = 0.25;
const HUE_SECTORS = 12;
const S_RANGE = [0.5, 0.85] as const;
const L_RANGE = [0.5, 0.62] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  return { h: rgbToHsv(r, g, b).h, s, l };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

const hex = (v: number) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');

/**
 * Акцент из пикселей RGB (3 байта на пиксель). Серое, чёрное и белое отбрасываются; побеждает сектор оттенка
 * с наибольшим весом s*v; сектор меньше 5% пикселей или пустой картинки -> null. Цвет подтягивается к читаемому на тёмном фоне.
 */
export function pickTintFromRgb(rgb: ArrayLike<number>): string | null {
  const total = Math.floor(rgb.length / 3);
  if (total === 0) return null;
  const weight = new Array<number>(HUE_SECTORS).fill(0);
  const count = new Array<number>(HUE_SECTORS).fill(0);
  const sum = Array.from({ length: HUE_SECTORS }, () => [0, 0, 0]);
  for (let i = 0; i < total; i++) {
    const r = rgb[i * 3] / 255;
    const g = rgb[i * 3 + 1] / 255;
    const b = rgb[i * 3 + 2] / 255;
    const { h, s, v } = rgbToHsv(r, g, b);
    if (s < MIN_SAT || v < MIN_VAL) continue;
    const k = Math.min(HUE_SECTORS - 1, Math.floor(h / (360 / HUE_SECTORS)));
    const w = s * v;
    weight[k] += w;
    count[k] += 1;
    sum[k][0] += r * w;
    sum[k][1] += g * w;
    sum[k][2] += b * w;
  }
  let best = -1;
  for (let k = 0; k < HUE_SECTORS; k++) if (weight[k] > 0 && (best < 0 || weight[k] > weight[best])) best = k;
  if (best < 0 || count[best] / total < MIN_SHARE) return null;
  const [r, g, b] = sum[best].map((x) => x / weight[best]);
  const hsl = rgbToHsl(r, g, b);
  const [rr, gg, bb] = hslToRgb(hsl.h, clamp(hsl.s, S_RANGE[0], S_RANGE[1]), clamp(hsl.l, L_RANGE[0], L_RANGE[1]));
  return `#${hex(rr)}${hex(gg)}${hex(bb)}`;
}
