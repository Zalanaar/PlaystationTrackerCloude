import { describe, expect, it } from 'vitest';
import { fitMeta, minutesText } from './timeFit';

const it0 = { id: 1, title: 'X', coverUrl: null, lastPlayedAt: null } as const;

describe('П12.5 подписи', () => {
  it('minutesText', () => {
    expect([0, 45, 60, 100, 119.6, 600, 1530].map(minutesText)).toEqual(['1 мин', '45 мин', '1 ч', '1 ч 40 мин', '2 ч', '10 ч', '26 ч']);
  });
  it('fitMeta', () => {
    expect(fitMeta({ ...it0, status: 'playing', remainingMinutes: 60 }, 120)).toBe('Играю · осталось ≈ 1 ч');
    expect(fitMeta({ ...it0, status: 'backlog', remainingMinutes: 130 }, 120)).toBe('Бэклог · осталось ≈ 2 ч 10 мин, впритык');
    expect(fitMeta({ ...it0, status: 'playing', remainingMinutes: 1500 }, 120)).toBe('Играю · осталось ≈ 25 ч');
    expect(fitMeta({ ...it0, status: 'playing', remainingMinutes: null }, 120)).toBe('Играю · длительность неизвестна');
  });
});
