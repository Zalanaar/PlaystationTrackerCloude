import { describe, expect, it } from 'vitest';
import { barPercent, fieldHint, hoursHintLabel, monthTitle, parseField, progressLine } from './model';

describe('подписи целей месяца', () => {
  it('заголовок, строка прогресса, шкала, разбор поля', () => {
    expect(monthTitle(11)).toBe('ноябрь');
    expect(progressLine('games', 2, 3)).toBe('2 из 3 игр');
    expect(progressLine('hours', 5, 20)).toBe('5 из 20 ч');
    expect(progressLine('trophies', 1, 1)).toBe('1 из 1 трофея');
    expect(barPercent(2, 4)).toBe(50);
    expect(barPercent(5, 4)).toBe(100);
    expect(parseField('', 'games')).toEqual({ ok: true, value: null });
    expect(parseField('3', 'games')).toEqual({ ok: true, value: 3 });
    expect(parseField('0', 'games')).toEqual({ ok: false });
    expect(parseField('101', 'games')).toEqual({ ok: false });
    expect(fieldHint('hours')).toContain('744');
    expect(hoursHintLabel(42)).toBe('В среднем 42 ч в месяц');
  });
});
