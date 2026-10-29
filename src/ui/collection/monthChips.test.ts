import { describe, expect, it } from 'vitest';
import type { GameItem } from '@/server/collection/types';
import type { ChronicleYear } from './chronicle';
import { anchorsByGame, currentMonthIndex, flatYearGames, monthAnchorId, monthChipAria, yearMonthChips } from './monthChips';

const g = (id: number) => ({ id }) as unknown as GameItem;
const year = (months: Array<[number, number[], number?, number?]>): Pick<ChronicleYear, 'year' | 'months'> => ({
  year: 2026,
  months: months.map(([month, ids, completed, dropped]) => ({ month, games: ids.map(g), completed: completed ?? ids.length, dropped: dropped ?? 0 })),
});

describe('yearMonthChips', () => {
  it('меньше двух месяцев: чипов нет', () => {
    expect(yearMonthChips(year([[10, [1, 2]]]))).toEqual([]);
    expect(yearMonthChips(year([]))).toEqual([]);
  });
  it('порядок как в сетке, подписи и числа', () => {
    const chips = yearMonthChips(year([[10, [1, 2, 3], 2, 1], [9, [4]]]));
    expect(chips.map((c) => [c.label, c.count, c.anchorId])).toEqual([['Окт', 3, 'm2026-10'], ['Сен', 1, 'm2026-09']]);
    expect(chips[0].aria).toBe('Октябрь: 2 пройдено, 1 брошено');
  });
  it('месяц без игр не выводится', () => {
    expect(yearMonthChips(year([[10, [1]], [9, []], [8, [2]]])).map((c) => c.month)).toEqual([10, 8]);
  });
});

describe('сетка и якоря', () => {
  it('flatYearGames склеивает месяцы по порядку', () => {
    expect(flatYearGames(year([[10, [1, 2]], [9, [3]]])).map((x) => x.id)).toEqual([1, 2, 3]);
  });
  it('якорь только у первой игры месяца', () => {
    expect([...anchorsByGame(year([[10, [1, 2]], [9, [3]]]))]).toEqual([[1, 'm2026-10'], [3, 'm2026-09']]);
  });
  it('monthAnchorId с нулём', () => expect(monthAnchorId(2026, 3)).toBe('m2026-03'));
  it('aria: брошено без пройдено', () => expect(monthChipAria(9, 0, 2)).toBe('Сентябрь: 2 брошено'));
});

describe('currentMonthIndex', () => {
  it('пока ни один якорь не дошёл до границы, первый', () => expect(currentMonthIndex([300, 900, 1500], 120)).toBe(0));
  it('последний прошедший границу', () => expect(currentMonthIndex([-800, 100, 700], 120)).toBe(1));
  it('допуск на точное попадание', () => expect(currentMonthIndex([-400, 121], 120)).toBe(1));
  it('пусто', () => expect(currentMonthIndex([], 0)).toBe(-1));
});
