// QA Фазы 11: границы ручной длительности, бакетов и разбора фильтров (независимо от тестов автора).
import { describe, expect, it } from 'vitest';
import { bucketOf } from './duration';
import { parseDurationBody, parseListQuery } from './validation';

const hours = (v: unknown) => parseDurationBody({ hours: v });

describe('QA Ф11: PATCH hours', () => {
  it.each([[0], [-1], [1001], [1000.06], ['5'], [''], [NaN], [Infinity], [true], [[]]])('%j -> отказ', (v) => {
    expect(hours(v).ok).toBe(false);
  });
  it.each([[0.1, 0.1], [1, 1], [24.55, 24.6], [1000, 1000], [1000.04, 1000]])('%j -> %j', (v, out) => {
    const r = hours(v);
    expect(r.ok && r.value.hours).toBe(out);
  });
  it('0.05 округляется до 0.1 (фиксируем поведение: контракт молчит)', () => {
    const r = hours(0.05);
    expect(r.ok && r.value.hours).toBe(0.1);
  });
  it('null = сброс; нет поля / не объект = отказ', () => {
    expect(hours(null)).toEqual({ ok: true, value: { hours: null } });
    expect(parseDurationBody({}).ok).toBe(false);
    expect(parseDurationBody(null).ok).toBe(false);
    expect(parseDurationBody('x').ok).toBe(false);
  });
});

describe('QA Ф11: бакеты', () => {
  it.each([[null, 'unknown'], [0.1, 'lt10'], [9.9, 'lt10'], [10, '10_30'], [29.9, '10_30'], [30, '30_60'], [59.9, '30_60'], [60, '60plus'], [1000, '60plus']])('%j -> %s', (h, b) => {
    expect(bucketOf(h)).toBe(b);
  });
});

describe('QA Ф11: параметры списка', () => {
  const q = (s: string) => parseListQuery(new URLSearchParams(s));
  it('неизвестные genres/duration -> 400', () => {
    expect(q('genres=NOPE').ok).toBe(false);
    expect(q('genres=ACTION,NOPE').ok).toBe(false);
    expect(q('duration=lt5').ok).toBe(false);
    expect(q('duration=lt10,zzz').ok).toBe(false);
    expect(q('duration=LT10').ok).toBe(false);
  });
  it('регистр жанров не важен, дубли схлопываются, пробелы режутся', () => {
    const r = q('genres=action, ACTION ,role_playing_games&duration=lt10,lt10,unknown');
    expect(r.ok && r.value.genres).toEqual(['ACTION', 'ROLE_PLAYING_GAMES']);
    expect(r.ok && r.value.durations).toEqual(['lt10', 'unknown']);
  });
  it('пустые значения = без фильтра; sort=duration asc по умолчанию', () => {
    const r = q('genres=&duration=&sort=duration');
    expect(r.ok && [r.value.genres, r.value.durations, r.value.order]).toEqual([null, null, 'asc']);
  });
  it('genres=, ,  (только запятые) не даёт тихого «без фильтра»', () => {
    expect(q('genres=,').ok).toBe(false);
  });
});
