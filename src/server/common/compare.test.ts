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
    expect(t).toEqual(['1', 'a', 'Б', 'ё', 'я']); // ё идёт как «е», до «я» (BUG-S3-2)
  });
  it('ё сортируется рядом с е, а не после я', () => {
    expect(['Яблоко', 'Ёлка', 'Ежик', 'Эхо'].sort(compareText)).toEqual(['Ежик', 'Ёлка', 'Эхо', 'Яблоко']);
    expect(compareText('ее', 'ёе')).toBeLessThan(0);
    expect(compareText('ёе', 'ей')).toBeLessThan(0);
    expect(compareText('Ёж', 'ёж')).toBe(0);
    expect(compareTitleId({ title: 'Ёж', id: 2 }, { title: 'Яма', id: 1 })).toBeLessThan(0);
  });
});
