import { describe, expect, it } from 'vitest';
import { pickPlayedMonth } from './playedMonth';

const months = ['2026-03', '2026-10', '2026-07'];
describe('pickPlayedMonth', () => {
  it('по умолчанию последний месяц с играми', () => expect(pickPlayedMonth(months, 'year', null)).toBe('2026-10'));
  it('?m= восстанавливает выбор', () => expect(pickPlayedMonth(months, 'year', '2026-07')).toBe('2026-07'));
  it('неизвестный или битый ?m= даёт последний', () => {
    expect(pickPlayedMonth(months, 'year', '2026-05')).toBe('2026-10');
    expect(pickPlayedMonth(months, 'year', '2026-13')).toBe('2026-10');
  });
  it('период «Месяц» игнорирует ?m=', () => expect(pickPlayedMonth(['2026-10'], 'month', '2026-03')).toBe('2026-10'));
  it('пусто', () => expect(pickPlayedMonth([], 'year', null)).toBeNull());
});
