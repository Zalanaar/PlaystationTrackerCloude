import { describe, expect, it } from 'vitest';
import type { GameItem } from '@/server/collection/types';
import {
  DEFAULT_FILTERS, adjustCounts, applyStatusLocally, completionInfo, dateInputToIso, dedupeContinue, filtersToApi,
  filtersToUrl, hasActiveFilters, isoToDateInput, parseFilters,
} from './filters';

const p = (s: string) => new URLSearchParams(s);
const game = (o: Partial<GameItem> = {}): GameItem => ({
  id: 1, title: 'X', coverUrl: null, platform: 'PS5', playSeconds: 0, hours: 0, playCount: 0, lastPlayedAt: '2026-10-05T18:42:11.000Z',
  status: null, completedAt: null, droppedAt: null, trophies: null, genres: [], ...o,
});

describe('фильтры <-> URL', () => {
  it('пустой URL = умолчания', () => {
    expect(parseFilters(p(''))).toEqual(DEFAULT_FILTERS);
  });
  it('круг: разбор и сборка', () => {
    const f = parseFilters(p('status=completed&year=2026&sort=hours&order=asc&q=halo&view=list'));
    expect(f).toEqual({ status: 'completed', year: 2026, sort: 'hours', order: 'asc', q: 'halo', view: 'list' });
    expect(filtersToUrl(f).toString()).toBe('status=completed&year=2026&sort=hours&order=asc&q=halo&view=list');
  });
  it('мусор откатывается', () => {
    const f = parseFilters(p('status=zzz&year=20x&sort=bad&order=up&view=cards'));
    expect(f).toEqual(DEFAULT_FILTERS);
    expect(parseFilters(p('year=1999')).year).toBeNull();
  });
  it('order по умолчанию не пишется в URL', () => {
    expect(parseFilters(p('sort=title&order=asc')).order).toBeNull();
    expect(filtersToUrl({ ...DEFAULT_FILTERS, sort: 'title', order: 'asc' }).toString()).toBe('sort=title');
  });
  it('query API: пробелы обрезаются, status all не шлётся', () => {
    const api = filtersToApi({ ...DEFAULT_FILTERS, q: '  halo ', year: 2025 }, { limit: 60, offset: 60 });
    expect(api.toString()).toBe('q=halo&year=2025&sort=last_played&limit=60&offset=60');
    expect(filtersToApi({ ...DEFAULT_FILTERS, status: 'none' }, { limit: 10, offset: 0 }).get('status')).toBe('none');
  });
  it('активные фильтры', () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, q: ' ' })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, year: 2026 })).toBe(true);
  });
});

describe('даты завершения и оптимистичные правки', () => {
  it('completionInfo', () => {
    expect(completionInfo(game({ status: 'completed', completedAt: '2026-09-20T00:00:00Z' }))).toEqual({ kind: 'completed', iso: '2026-09-20T00:00:00Z' });
    expect(completionInfo(game({ status: 'dropped', droppedAt: '2026-01-01T00:00:00Z' }))?.kind).toBe('dropped');
    expect(completionInfo(game({ status: 'playing' }))).toBeNull();
  });
  it('applyStatusLocally: completed берёт последний запуск, повтор ничего не трогает', () => {
    const g = applyStatusLocally(game(), 'completed', '2026-10-27T00:00:00Z');
    expect(g.completedAt).toBe('2026-10-05T18:42:11.000Z');
    const manual = game({ status: 'completed', completedAt: '2026-01-01T00:00:00Z' });
    expect(applyStatusLocally(manual, 'completed', 'now')).toBe(manual);
    expect(applyStatusLocally(manual, 'backlog', 'now').completedAt).toBeNull();
    expect(applyStatusLocally(game({ lastPlayedAt: null }), 'dropped', '2026-10-27T00:00:00Z').droppedAt).toBe('2026-10-27T00:00:00Z');
  });
  it('счётчики', () => {
    const c = { all: 3, playing: 1, completed: 0, dropped: 0, backlog: 0, shelved: 0, none: 2 };
    expect(adjustCounts(c, null, 'completed')).toEqual({ ...c, completed: 1, none: 1 });
    expect(adjustCounts(c, 'playing', null)).toEqual({ ...c, playing: 0, none: 3 });
  });
  it('dedupeContinue убирает игру из «Играю сейчас»', () => {
    expect(dedupeContinue(game({ id: 1 }), [game({ id: 1 }), game({ id: 2 })]).map((g) => g.id)).toEqual([2]);
    expect(dedupeContinue(undefined, [game({ id: 1 })])).toHaveLength(1);
  });
  it('dateInputToIso: день по Москве, не позже now, мусор = null', () => {
    const now = Date.parse('2026-10-27T09:00:00Z');
    expect(dateInputToIso('2026-09-20', now)).toBe('2026-09-20T09:00:00.000Z');
    expect(isoToDateInput('2026-09-20T09:00:00.000Z')).toBe('2026-09-20');
    expect(dateInputToIso('2026-10-27', now)).toBe('2026-10-27T09:00:00.000Z');
    expect(dateInputToIso('2026-12-31', now)).toBe(new Date(now).toISOString());
    expect(dateInputToIso('2026-02-31', now)).toBeNull();
    expect(dateInputToIso('', now)).toBeNull();
  });
});
