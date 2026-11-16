import { describe, expect, it } from 'vitest';
import { scrollEdges, scrollToShow } from './useChipRow';

describe('П9: ряд чипов', () => {
  it('края: тень только там, где есть ещё чипы', () => {
    expect(scrollEdges(0, 300, 300)).toEqual({ l: false, r: false });
    expect(scrollEdges(0, 300, 600)).toEqual({ l: false, r: true });
    expect(scrollEdges(150, 300, 600)).toEqual({ l: true, r: true });
    expect(scrollEdges(299, 300, 600)).toEqual({ l: true, r: false });
  });
  it('прокрутка к выбранному: виден — не трогаем; справа/слева — докрутить с запасом', () => {
    expect(scrollToShow(100, 80, 0, 300)).toBeNull();
    expect(scrollToShow(400, 80, 0, 300)).toBe(196);
    expect(scrollToShow(20, 80, 100, 300)).toBe(4);
    expect(scrollToShow(5, 80, 100, 300)).toBe(0);
  });
});
