// QA Фаз 9.1/15: граничные значения входа новых эндпоинтов (400, а не 500).
import { describe, expect, it } from 'vitest';
import { parseListQuery, parseMonthExclusionBody } from './validation';
import { parseActivityQuery } from '@/server/stats/validation';

describe('parseMonthExclusionBody', () => {
  it.each(['2026-03', '2000-01', '2100-12'])('принимает %s', (month) => {
    expect(parseMonthExclusionBody({ month, excluded: true }).ok).toBe(true);
  });
  it.each(['2026-3', '2026-13', '2026-00', '1999-12', '2101-01', '2026-03\n', ' 2026-03', '2026-03-01', '', 'март', '０２０２６-03'])(
    'отклоняет month %j',
    (month) => {
      expect(parseMonthExclusionBody({ month, excluded: true }).ok).toBe(false);
    },
  );
  it.each([null, undefined, 1, ['2026-03'], { a: 1 }])('отклоняет month не строку %j', (month) => {
    expect(parseMonthExclusionBody({ month, excluded: true }).ok).toBe(false);
  });
  it.each([undefined, null, 'true', 1, 0])('excluded должен быть boolean: %j', (excluded) => {
    expect(parseMonthExclusionBody({ month: '2026-03', excluded }).ok).toBe(false);
  });
  it.each([null, 'x', 5, undefined, []])('тело не объект: %j', (b) => {
    expect(parseMonthExclusionBody(b).ok).toBe(false);
  });
});

describe('parseActivityQuery', () => {
  const q = (s: string) => parseActivityQuery(new URLSearchParams(s), 2026);
  it('по умолчанию текущий год', () => expect(q('')).toEqual({ ok: true, value: { year: 2026 } }));
  it('пустой year = нет параметра', () => expect(q('year=')).toEqual({ ok: true, value: { year: 2026 } }));
  it.each(['abc', '1999', '2101', '-1', '2026.5', '20260', '0x7e9', '2026%20', '1e3'])('year=%s -> 400', (y) => {
    expect(q(`year=${y}`).ok).toBe(false);
  });
});

describe('parseListQuery: forgotten', () => {
  const q = (s: string) => parseListQuery(new URLSearchParams(s));
  it('only включает фильтр', () => {
    const r = q('forgotten=only');
    expect(r.ok && r.value.forgottenOnly).toBe(true);
  });
  it('пусто/нет — выключено', () => {
    for (const s of ['', 'forgotten=']) {
      const r = q(s);
      expect(r.ok && r.value.forgottenOnly).toBe(false);
    }
  });
  it.each(['1', 'true', 'ONLY', 'all', 'only,none'])('forgotten=%s -> 400', (v) => {
    expect(q(`forgotten=${v}`).ok).toBe(false);
  });
});
