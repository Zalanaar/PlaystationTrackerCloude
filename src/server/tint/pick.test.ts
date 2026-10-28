import { describe, expect, it } from 'vitest';
import { pickTintFromRgb } from './pick';

const fill = (n: number, c: [number, number, number]) => Array.from({ length: n }, () => c).flat();

describe('pickTintFromRgb', () => {
  it('пусто и серое -> null', () => {
    expect(pickTintFromRgb([])).toBeNull();
    expect(pickTintFromRgb(fill(1024, [128, 128, 128]))).toBeNull();
    expect(pickTintFromRgb(fill(1024, [0, 0, 0]))).toBeNull();
    expect(pickTintFromRgb(fill(1024, [255, 255, 255]))).toBeNull();
  });
  it('доминантный цвет: красный преобладает над синим, результат hex в диапазоне светлоты', () => {
    const px = [...fill(600, [200, 20, 20]), ...fill(100, [20, 20, 200]), ...fill(324, [10, 10, 10])];
    const hex = pickTintFromRgb(px)!;
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g * 2);
    expect(r).toBeGreaterThan(b * 2);
  });
  it('фон не мешает: тёмный фон и белый текст отбрасываются', () => {
    const px = [...fill(500, [0, 0, 0]), ...fill(300, [250, 250, 250]), ...fill(224, [20, 160, 60])];
    const hex = pickTintFromRgb(px)!;
    const g = parseInt(hex.slice(3, 5), 16);
    expect(g).toBeGreaterThan(parseInt(hex.slice(1, 3), 16));
  });
  it('цвет занимает меньше 5% пикселей -> null', () => {
    const px = [...fill(40, [200, 20, 20]), ...fill(984, [128, 128, 128])];
    expect(pickTintFromRgb(px)).toBeNull();
    expect(pickTintFromRgb([...fill(60, [200, 20, 20]), ...fill(964, [128, 128, 128])])).not.toBeNull();
  });
  it('тусклый и яркий цвет подтягиваются в читаемый диапазон светлоты', () => {
    const dark = pickTintFromRgb(fill(1024, [90, 10, 10]))!;
    const light = pickTintFromRgb(fill(1024, [255, 150, 150]))!;
    const lum = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).reduce((a, b) => a + b, 0);
    expect(lum(dark)).toBeGreaterThan(90 + 10 + 10);
    expect(lum(light)).toBeLessThan(255 + 150 + 150);
  });
});
