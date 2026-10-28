import { describe, expect, it } from 'vitest';
import { compareText, compareTitleId } from './compare';

describe('compare', () => {
  it('регистр не важен, затем id', () => {
    expect(compareText('Abc', 'abc')).toBe(0);
    expect(compareText('a', 'B')).toBe(-1);
    expect(compareTitleId({ title: 'Game', id: 2 }, { title: 'game', id: 1 })).toBeGreaterThan(0);
    expect(compareTitleId({ title: 'Game', id: 1 }, { title: 'game', id: 2 })).toBeLessThan(0);
  });
  it('детерминированный порядок без локали', () => {
    const t = ['я', 'Б', 'a', '1', 'ё'].sort(compareText);
    expect(t).toEqual(['1', 'a', 'Б', 'я', 'ё']); // по кодовым единицам: ё (U+0451) после я
  });
});
