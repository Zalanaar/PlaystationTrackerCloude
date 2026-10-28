import { describe, expect, it } from 'vitest';
import type { StatsResponse } from '@/server/stats/types';
import { isEmptyPeriod } from './model';

const z = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };
function make(over: Partial<{ byMonth: (number | null)[]; completed: number; hours: number | null; total: number; groups: number; genres: boolean }> = {}): StatsResponse {
  return {
    header: { completed: over.completed ?? 0, dropped: 0, hours: over.hours ?? 0, platinum: 0 },
    hours: { byMonth: over.byMonth ?? Array(12).fill(null), firstSnapshotDate: null, periodPartial: false },
    genres: { hasData: over.genres ?? false, items: [] },
    trophies: { counts: { ...z, total: over.total ?? 0 }, byMonth: [] },
    finished: { groups: [] },
    played: { games: {}, groups: Array(over.groups ?? 0).fill({ month: '2026-03', year: 2026, monthNumber: 3, completed: 0, dropped: 0, items: [] }) },
  } as unknown as StatsResponse; // тест покрывает только поля, которые читает isEmptyPeriod
}

describe('isEmptyPeriod', () => {
  const withMonths = [null, 5, 0, 12, ...Array(8).fill(null)];
  it('год: часы по месяцам делают период непустым', () => {
    expect(isEmptyPeriod(make({ byMonth: withMonths }), 'year')).toBe(false);
  });
  it('месяц: byMonth за весь год не учитывается', () => {
    expect(isEmptyPeriod(make({ byMonth: withMonths }), 'month')).toBe(true);
  });
  it('год без данных пуст, нули и null в byMonth не считаются', () => {
    expect(isEmptyPeriod(make({ byMonth: Array(12).fill(0) }), 'year')).toBe(true);
    expect(isEmptyPeriod(make({ hours: null }), 'year')).toBe(true);
  });
  it('любые данные периода делают его непустым и для месяца', () => {
    expect(isEmptyPeriod(make({ completed: 1 }), 'month')).toBe(false);
    expect(isEmptyPeriod(make({ hours: 3 }), 'month')).toBe(false);
    expect(isEmptyPeriod(make({ total: 2 }), 'month')).toBe(false);
    expect(isEmptyPeriod(make({ groups: 1 }), 'month')).toBe(false);
    expect(isEmptyPeriod(make({ genres: true }), 'month')).toBe(false);
  });
});
