import { describe, expect, it } from 'vitest';
import type { DayResponse } from '@/server/stats/day';
import { dayEmptyText, daySummary, trophyTypesLine } from './day';

const base = (o: Partial<DayResponse> = {}): DayResponse => ({
  date: '2026-11-03', today: '2026-11-10', known: true, minutes: 0, games: [], finished: [], prev: null, next: null,
  trophies: { counts: { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 }, items: [] }, ...o,
});

describe('П11.1 подписи дня', () => {
  it('итог дня', () => {
    const d = base({
      minutes: 95, games: [{ id: 1, title: 'A', coverUrl: null, minutes: 60 }, { id: 2, title: 'B', coverUrl: null, minutes: 35 }],
      trophies: { counts: { platinum: 1, gold: 0, silver: 0, bronze: 2, total: 3 }, items: [] },
      finished: [{ id: 1, title: 'A', coverUrl: null, kind: 'completed' }],
    });
    expect(daySummary(d)).toBe('1 ч 35 м · 2 игры · +3 трофея · пройдена 1');
    expect(trophyTypesLine(d)).toBe('1 платина · 2 бронзы');
    expect(daySummary(base({ finished: [{ id: 1, title: 'A', coverUrl: null, kind: 'dropped' }, { id: 2, title: 'B', coverUrl: null, kind: 'dropped' }] }))).toBe('брошены 2');
    expect(daySummary(base())).toBe('');
  });
  it('пустой день: известный, неизвестный, будущий', () => {
    expect(dayEmptyText(base())).toBe('В этот день игры не было.');
    expect(dayEmptyText(base({ known: false }))).toMatch(/^Нет данных/);
    expect(dayEmptyText(base({ date: '2026-11-12', known: false }))).toBe('Этот день ещё не наступил.');
  });
});
