import { describe, expect, it } from 'vitest';
import { parseBulkBody, parseDateBody, parseGameId, parseListQuery, parseStatusBody } from './validation';

const q = (s: string) => parseListQuery(new URLSearchParams(s));

describe('parseListQuery', () => {
  it('значения по умолчанию', () => {
    expect(q('')).toEqual({ ok: true, value: { q: null, statuses: null, year: null, sort: 'last_played', order: 'desc', limit: 60, offset: 0, hiddenOnly: false, forgottenOnly: false } });
  });
  it('направление по умолчанию зависит от сортировки', () => {
    expect(q('sort=title')).toMatchObject({ value: { order: 'asc' } });
    expect(q('sort=title&order=desc')).toMatchObject({ value: { order: 'desc' } });
    expect(q('sort=hours')).toMatchObject({ value: { order: 'desc' } });
  });
  it('status: service принимается в фильтре и в теле', () => {
    expect(q('status=service,none')).toMatchObject({ value: { statuses: ['service', 'none'] } });
    expect(parseStatusBody({ status: 'service' })).toEqual({ ok: true, value: { status: 'service' } });
    expect(parseBulkBody({ ids: [2], status: 'service' }).ok).toBe(true);
  });
  it('status: список, none, дубли; мусор = ошибка', () => {
    expect(q('status=playing,none,playing')).toMatchObject({ value: { statuses: ['playing', 'none'] } });
    expect(q('status=')).toMatchObject({ value: { statuses: null } });
    expect(q('status=playing,wat').ok).toBe(false);
    expect(q('status=all').ok).toBe(false);
  });
  it('q обрезается, длинный = ошибка', () => {
    expect(q('q=%20%20Zelda%20')).toMatchObject({ value: { q: 'Zelda' } });
    expect(q('q=%20%20')).toMatchObject({ value: { q: null } });
    expect(q(`q=${'a'.repeat(101)}`).ok).toBe(false);
  });
  it('year, limit, offset: границы', () => {
    expect(q('year=2026')).toMatchObject({ value: { year: 2026 } });
    for (const bad of ['year=abc', 'year=1999', 'year=2101', 'limit=0', 'limit=301', 'limit=-1', 'offset=-1', 'offset=x', 'sort=nope', 'order=up']) {
      expect(q(bad).ok, bad).toBe(false);
    }
    expect(q('limit=300&offset=0')).toMatchObject({ value: { limit: 300 } });
  });
});

describe('тела запросов', () => {
  it('id игры', () => {
    expect(parseGameId('17')).toBe(17);
    for (const b of ['0', '-1', 'abc', '1.5', '99999999999', '']) expect(parseGameId(b), b).toBeNull();
  });
  it('status: значение или null; отсутствие и мусор = ошибка', () => {
    expect(parseStatusBody({ status: 'backlog' })).toEqual({ ok: true, value: { status: 'backlog' } });
    expect(parseStatusBody({ status: null })).toEqual({ ok: true, value: { status: null } });
    expect(parseStatusBody({}).ok).toBe(false);
    expect(parseStatusBody({ status: 'none' }).ok).toBe(false);
    expect(parseStatusBody(null).ok).toBe(false);
    expect(parseStatusBody('playing').ok).toBe(false);
  });
  it('bulk: до 250, дубли схлопываются, пусто и больше = ошибка', () => {
    expect(parseBulkBody({ ids: [3, 1, 3], status: 'playing' })).toEqual({ ok: true, value: { ids: [1, 3], status: 'playing' } });
    expect(parseBulkBody({ ids: Array.from({ length: 250 }, (_, i) => i + 1), status: null }).ok).toBe(true);
    expect(parseBulkBody({ ids: Array.from({ length: 251 }, (_, i) => i + 1), status: null }).ok).toBe(false);
    expect(parseBulkBody({ ids: [], status: 'playing' }).ok).toBe(false);
    expect(parseBulkBody({ ids: [0], status: 'playing' }).ok).toBe(false);
    expect(parseBulkBody({ ids: ['1'], status: 'playing' }).ok).toBe(false);
    expect(parseBulkBody({ ids: [1], status: 'x' }).ok).toBe(false);
    expect(parseBulkBody({ ids: [1] }).ok).toBe(false);
  });
  it('дата: ровно одно поле, ISO', () => {
    const r = parseDateBody({ completedAt: '2026-09-20T00:00:00.000Z' });
    expect(r).toMatchObject({ ok: true, value: { field: 'completedAt' } });
    expect(parseDateBody({ droppedAt: '2026-09-20T03:00:00+03:00' })).toMatchObject({ ok: true, value: { field: 'droppedAt' } });
    expect(parseDateBody({}).ok).toBe(false);
    expect(parseDateBody({ completedAt: '2026-09-20T00:00:00Z', droppedAt: '2026-09-20T00:00:00Z' }).ok).toBe(false);
    expect(parseDateBody({ completedAt: null }).ok).toBe(false);
    expect(parseDateBody({ completedAt: '20.09.2026' }).ok).toBe(false);
    expect(parseDateBody({ completedAt: '2026-09-20' }).ok).toBe(false);
  });
});
