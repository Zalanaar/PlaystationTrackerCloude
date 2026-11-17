import { describe, expect, it } from 'vitest';
import { formatNumber } from '../format';
import { parseRubInput, perHourText, priceLine, rub } from './model';

describe('П13.3: подписи цены', () => {
  it('ввод', () => {
    expect(parseRubInput('')).toBeNull();
    expect(parseRubInput(' 3 999 ₽')).toBe(3999);
    expect(parseRubInput('0')).toBe(0);
    for (const bad of ['-1', '12.5', 'abc', '1000001', '99999999']) expect(parseRubInput(bad)).toBeUndefined();
  });
  it('строки', () => {
    expect(rub(3999)).toBe(`${formatNumber(3999)} ₽`);
    expect(perHourText(3.3)).toBe('3,3 ₽/ч');
    expect(perHourText(100)).toBe('100 ₽/ч');
    expect(priceLine(4000, 40)).toBe(`Куплена за ${formatNumber(4000)} ₽ · час стоит 100 ₽/ч`);
    expect(priceLine(4000, 0.5)).toBe(`Куплена за ${formatNumber(4000)} ₽ · сыграно меньше часа`);
    expect(priceLine(0, 10)).toBe('Бесплатно · час стоит 0 ₽/ч');
  });
});
