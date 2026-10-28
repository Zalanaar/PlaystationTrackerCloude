import { describe, expect, it } from 'vitest';
import { parseStatsQuery } from './validation';

const q = (s: string) => parseStatsQuery(new URLSearchParams(s), 2026);

describe('parseStatsQuery', () => {
  it('по умолчанию: год, текущий год', () => {
    expect(q('')).toEqual({ ok: true, value: { type: 'year', year: 2026, month: null } });
  });
  it('year: month игнорируется (даже мусорный)', () => {
    expect(q('period=year&year=2025&month=99')).toEqual({ ok: true, value: { type: 'year', year: 2025, month: null } });
  });
  it('month: обязателен', () => {
    expect(q('period=month&year=2026&month=10')).toEqual({ ok: true, value: { type: 'month', year: 2026, month: 10 } });
    for (const b of ['period=month', 'period=month&month=0', 'period=month&month=13', 'period=month&month=x']) expect(q(b).ok, b).toBe(false);
  });
  it('мусор', () => {
    for (const b of ['period=week', 'year=abc', 'year=1999', 'year=2101', 'year=-1']) expect(q(b).ok, b).toBe(false);
  });
});
