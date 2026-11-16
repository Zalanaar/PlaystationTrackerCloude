import { describe, expect, it } from 'vitest';
import type { PlayedGroup, StatsResponse } from '@/server/stats/types';
import { monthSummary } from './monthSummary';

const months = <T extends number | null>(f: (m: number) => T): T[] => Array.from({ length: 12 }, (_, i) => f(i + 1));
const data = (o: { year?: number; byMonth?: (number | null)[]; est?: number[]; tr?: { month: number; total: number; platinum: number }[] } = {}) => ({
  period: { type: 'year', year: o.year ?? 2026 },
  hours: { byMonth: o.byMonth ?? months(() => null), estimatedByMonth: o.est ?? months<number>(() => 0) },
  trophies: { byMonth: (o.tr ?? []).map((t) => ({ gold: 0, silver: 0, bronze: 0, ...t })) },
  played: { games: { 1: { title: 'Хорайзон' }, 2: { title: 'Астро' } }, groups: [] },
}) as unknown as StatsResponse;
const group = (items: [number, number][]): PlayedGroup => ({
  month: '2026-03', year: 2026, monthNumber: 3, completed: 0, dropped: 0,
  items: items.map(([gameId, hours]) => ({ gameId, hours, estimated: false, finished: null, finishedAt: null })),
});

describe('П11.4 мини-итоги месяца', () => {
  it('часы, трофеи, главная игра с долей', () => {
    const d = data({ byMonth: months((m) => (m === 3 ? 20 : null)), tr: [{ month: 3, total: 14, platinum: 2 }] });
    expect(monthSummary(d, group([[2, 5], [1, 15]])).map((p) => p.text)).toEqual(['20 ч за месяц', '14 трофеев, 2 платины', 'больше всего — Хорайзон (15 ч, 75%)']);
  });
  it('оценка — «≈»; одна игра — без «больше всего»; пусто', () => {
    const d = data({ byMonth: months((m) => (m === 3 ? 2 : null)), est: months<number>((m) => (m === 3 ? 1 : 0)) });
    expect(monthSummary(d, group([[1, 2]])).map((p) => p.text)).toEqual(['≈ 2 ч за месяц']);
    expect(monthSummary(data(), group([[1, 0]]))).toEqual([]);
  });
});
