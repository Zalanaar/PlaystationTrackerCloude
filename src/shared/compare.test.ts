import { describe, expect, it } from 'vitest';
import { compareText as serverCompare } from '../server/common/compare';
import { compareText } from './compare';

describe('compareText (shared)', () => {
  it('«ё» как «е», при равенстве «е» раньше «ё»', () => {
    expect(compareText('Ёжик', 'Яблоко')).toBeLessThan(0);
    expect(compareText('еж', 'ёж')).toBeLessThan(0);
    expect(compareText('ёж', 'еж')).toBeGreaterThan(0);
    expect(compareText('Дом', 'дом')).toBe(0);
  });
  it('совпадает с серверной версией', () => {
    const xs = ['Ёлка', 'ель', 'Яма', 'abc', 'ABC', 'Зов', 'зёрна'];
    for (const a of xs) for (const b of xs) expect(Math.sign(compareText(a, b))).toBe(Math.sign(serverCompare(a, b)));
  });
});
