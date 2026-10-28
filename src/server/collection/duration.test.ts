import { describe, expect, it } from 'vitest';
import { bucketOf, buildDuration, effectiveDuration, hltbStatus, normalizeOverrideHours } from './duration';
import { parseDurationBody, parseListQuery } from './validation';

describe('бакеты', () => {
  it('границы: 10, 30, 60 попадают в верхний бакет', () => {
    expect(bucketOf(0.1)).toBe('lt10');
    expect(bucketOf(9.9)).toBe('lt10');
    expect(bucketOf(10)).toBe('10_30');
    expect(bucketOf(29.9)).toBe('10_30');
    expect(bucketOf(30)).toBe('30_60');
    expect(bucketOf(59.9)).toBe('30_60');
    expect(bucketOf(60)).toBe('60plus');
    expect(bucketOf(400)).toBe('60plus');
  });
  it('нет данных = unknown', () => {
    expect(bucketOf(null)).toBe('unknown');
    expect(bucketOf(0)).toBe('unknown');
    expect(bucketOf(Number.NaN)).toBe('unknown');
  });
});

describe('приоритет ручной длительности', () => {
  it('override выигрывает у HLTB, extra не участвует', () => {
    expect(effectiveDuration({ override: 5, main: 40 })).toEqual({ hours: 5, source: 'manual' });
    expect(effectiveDuration({ override: null, main: 40 })).toEqual({ hours: 40, source: 'hltb' });
    expect(effectiveDuration({ override: null, main: null })).toEqual({ hours: null, source: null });
  });
  it('buildDuration: manual + found', () => {
    const d = buildDuration({ durationOverrideHours: 25, hltbId: 7, hltbName: 'Hades', hltbMainHours: 22, hltbExtraHours: 35, hltbCheckedAt: new Date('2026-10-01T00:00:00Z') });
    expect(d).toMatchObject({ hours: 25, source: 'manual', bucket: '10_30', overrideHours: 25 });
    expect(d.hltb).toMatchObject({ status: 'found', id: 7, mainHours: 22, extraHours: 35, checkedAt: '2026-10-01T00:00:00.000Z' });
  });
  it('buildDuration: пустая строка = unchecked/unknown (старые данные до миграции)', () => {
    const d = buildDuration({});
    expect(d).toMatchObject({ hours: null, source: null, bucket: 'unknown', overrideHours: null });
    expect(d.hltb).toMatchObject({ status: 'unchecked', id: null, checkedAt: null });
  });
  it('not_found: проверяли, совпадения нет; ручная длительность всё равно работает', () => {
    expect(hltbStatus({ id: null, checkedAt: new Date() })).toBe('not_found');
    const d = buildDuration({ hltbId: null, hltbCheckedAt: new Date('2026-10-01T00:00:00Z'), durationOverrideHours: 8 });
    expect(d).toMatchObject({ hours: 8, source: 'manual', bucket: 'lt10' });
    expect(d.hltb.status).toBe('not_found');
  });
});

describe('ручной ввод', () => {
  it('нормализация и границы', () => {
    expect(normalizeOverrideHours(12.34)).toBe(12.3);
    expect(normalizeOverrideHours(0.1)).toBe(0.1);
    expect(normalizeOverrideHours(1000)).toBe(1000);
    for (const bad of [0, -1, 0.04, 1000.1, Number.NaN, Infinity, '5', null, undefined]) expect(normalizeOverrideHours(bad)).toBeNull();
  });
  it('parseDurationBody', () => {
    expect(parseDurationBody({ hours: 5 })).toEqual({ ok: true, value: { hours: 5 } });
    expect(parseDurationBody({ hours: null })).toEqual({ ok: true, value: { hours: null } });
    for (const b of [{}, { hours: 0 }, { hours: '5' }, { hours: 5000 }, null, 'x']) expect(parseDurationBody(b).ok).toBe(false);
  });
});

describe('параметры списка: genres, duration, sort=duration', () => {
  const parse = (q: string) => parseListQuery(new URLSearchParams(q));
  it('разбор', () => {
    const r = parse('genres=action,role_playing_games,SIMULATOR&duration=lt10,unknown&sort=duration');
    expect(r.ok && r.value).toMatchObject({ genres: ['ACTION', 'ROLE_PLAYING_GAMES', 'SIMULATION'], durations: ['lt10', 'unknown'], sort: 'duration', order: 'asc' });
  });
  it('по умолчанию без фильтров', () => {
    const r = parse('');
    expect(r.ok && r.value).toMatchObject({ genres: null, durations: null });
  });
  it('мусор = ошибка', () => {
    expect(parse('genres=nope').ok).toBe(false);
    expect(parse('duration=1_2').ok).toBe(false);
    expect(parse('genres=ACTION,,').ok).toBe(true);
  });
});
