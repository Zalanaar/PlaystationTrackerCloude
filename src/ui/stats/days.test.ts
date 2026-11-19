import { describe, expect, it } from 'vitest';
import { dayValueText, daysModel } from './days';

describe('F20 daysModel', () => {
  it('все дни месяца, высоты от максимума, лучший день и итог', () => {
    const m = daysModel([{ date: '2026-11-02', minutes: 60 }, { date: '2026-11-03', minutes: 0 }, { date: '2026-11-10', minutes: 120 }, { date: '2026-10-31', minutes: 500 }], 2026, 11);
    expect(m.bars).toHaveLength(30);
    expect(m.bars[1]).toMatchObject({ day: 2, minutes: 60, heightPct: 50 });
    expect(m.bars[2]).toMatchObject({ minutes: 0, heightPct: 0 });
    expect(m.bars[0].minutes).toBeNull();
    expect(m.best?.day).toBe(10);
    expect(m.totalMinutes).toBe(180);
    expect(m.playedDays).toBe(2);
    expect(m.hasData).toBe(true);
  });
  it('февраль високосного года и пустой месяц', () => {
    const m = daysModel([], 2028, 2);
    expect(m.bars).toHaveLength(29);
    expect(m.hasData).toBe(false);
    expect(m.best).toBeNull();
  });
  it('подписи значений', () => {
    expect(dayValueText(null)).toBe('нет данных');
    expect(dayValueText(0)).toBe('не играл');
  });
});
