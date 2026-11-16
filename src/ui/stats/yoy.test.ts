import { describe, expect, it } from 'vitest';
import type { StatsResponse } from '@/server/stats/types';
import { buildYoy, signed } from './yoy';

const tr = (month: number, platinum: number) => ({ month, platinum, gold: 0, silver: 0, bronze: 0, total: platinum });
const grp = (year: number, m: number, completed: number, dropped = 0) => ({ month: `${year}-${String(m).padStart(2, '0')}`, year, monthNumber: m, completed, dropped, items: [] });
const stats = (o: { byMonth: (number | null)[]; plat?: [number, number][]; groups?: ReturnType<typeof grp>[] }) => ({
  hours: { byMonth: o.byMonth }, trophies: { byMonth: (o.plat ?? []).map(([m, n]) => tr(m, n)) }, played: { games: {}, groups: o.groups ?? [] },
}) as unknown as StatsResponse;
const months = (f: (m: number) => number | null) => Array.from({ length: 12 }, (_, i) => f(i + 1));
const TODAY = { year: 2026, month: 3 };

describe('П11.3 год к году', () => {
  it('прошлый год целиком', () => {
    const cur = stats({ byMonth: months(() => 10), plat: [[5, 2]], groups: [grp(2025, 5, 3, 1)] });
    const prev = stats({ byMonth: months(() => 5), plat: [[1, 1], [12, 2]], groups: [grp(2024, 2, 1)] });
    const y = buildYoy(cur, prev, { period: 'year', year: 2025, month: null }, TODAY)!;
    expect(y.title).toBe('К 2024 году');
    expect(y.note).toBeNull();
    expect(y.items.map((i) => [i.key, i.delta])).toEqual([['hours', 60], ['completed', 2], ['dropped', 1], ['platinum', -1]]);
  });
  it('текущий год: январь..текущий месяц обоих лет', () => {
    const cur = stats({ byMonth: months((m) => (m <= 3 ? 10 : null)), groups: [grp(2026, 1, 1)] });
    const prev = stats({ byMonth: months(() => 4), plat: [[2, 1], [7, 5]], groups: [grp(2025, 3, 2), grp(2025, 9, 4)] });
    const y = buildYoy(cur, prev, { period: 'year', year: 2026, month: null }, TODAY)!;
    expect(y.title).toBe('К янв–мар 2025');
    expect(y.note).toBe('мар 2025 — месяц целиком');
    expect(y.items.map((i) => [i.key, i.cur, i.prev])).toEqual([['hours', 30, 12], ['completed', 1, 2], ['platinum', 0, 1]]);
  });
  it('месяц: тот же месяц прошлого года; нет данных прошлого года — null; часы без данных не сравниваются', () => {
    const cur = stats({ byMonth: months((m) => (m === 3 ? 8.25 : null)) });
    const prev = stats({ byMonth: months((m) => (m === 3 ? 2 : null)), plat: [[3, 1]] });
    const y = buildYoy(cur, prev, { period: 'month', year: 2026, month: 3 }, TODAY)!;
    expect(y.title).toBe('К марте 2025');
    expect(y.items.find((i) => i.key === 'hours')!.delta).toBe(6.3);
    expect(buildYoy(cur, stats({ byMonth: months(() => null) }), { period: 'month', year: 2026, month: 3 }, TODAY)).toBeNull();
    const noHours = buildYoy(stats({ byMonth: months(() => null) }), prev, { period: 'month', year: 2026, month: 3 }, TODAY)!;
    expect(noHours.items.map((i) => i.key)).toEqual(['completed', 'platinum']);
  });
  it('знак', () => {
    expect(signed(3)).toBe('+3');
    expect(signed(-2)).toBe('−2');
    expect(signed(0)).toBe('0');
    expect(signed(-1.5, (n) => `${n} ч`)).toBe('−1.5 ч');
  });
});
