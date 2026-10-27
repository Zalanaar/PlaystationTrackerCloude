import { describe, expect, it } from 'vitest';
import type { GameItem } from '@/server/collection/types';
import {
  DEFAULT_FILTERS, adjustCounts, applyStatusLocally, completionInfo, blockQuery, dateInputToIso, effectiveView, filtersToApi,
  filtersToUrl, hasActiveFilters, isChronicleMode, isoToDateInput, matchesStatusTab, parseFilters,
} from './filters';

const p = (s: string) => new URLSearchParams(s);
const game = (o: Partial<GameItem> = {}): GameItem => ({
  id: 1, title: 'X', coverUrl: null, platform: 'PS5', playSeconds: 0, hours: 0, playCount: 0, lastPlayedAt: '2026-10-05T18:42:11.000Z',
  status: null, completedAt: null, droppedAt: null, trophies: null, genres: [], ...o,
});

describe('фильтры <-> URL', () => {
  it('пустой URL = умолчания (сортировка по дате завершения, вид не задан)', () => {
    expect(parseFilters(p(''))).toEqual(DEFAULT_FILTERS);
    expect(DEFAULT_FILTERS.sort).toBe('completed_at');
    expect(DEFAULT_FILTERS.view).toBeNull();
  });
  it('круг: разбор и сборка', () => {
    const f = parseFilters(p('status=completed&sort=hours&order=asc&q=halo&view=dense'));
    expect(f).toEqual({ status: 'completed', sort: 'hours', order: 'asc', q: 'halo', view: 'dense' });
    expect(filtersToUrl(f).toString()).toBe('status=completed&sort=hours&order=asc&q=halo&view=dense');
  });
  it('мусор откатывается, год из URL игнорируется', () => {
    const f = parseFilters(p('status=zzz&year=2026&sort=bad&order=up&view=cards'));
    expect(f).toEqual(DEFAULT_FILTERS);
  });
  it('order по умолчанию не пишется в URL', () => {
    expect(parseFilters(p('sort=title&order=asc')).order).toBeNull();
    expect(filtersToUrl({ ...DEFAULT_FILTERS, sort: 'title', order: 'asc' }).toString()).toBe('sort=title');
    expect(filtersToUrl({ ...DEFAULT_FILTERS, sort: 'last_played' }).toString()).toBe('sort=last_played');
  });
  it('вид: URL главнее localStorage, затем умолчание', () => {
    expect(effectiveView({ view: 'list' }, 'dense')).toBe('list');
    expect(effectiveView({ view: null }, 'dense')).toBe('dense');
    expect(effectiveView({ view: null }, 'bogus')).toBe('comfort');
    expect(effectiveView({ view: null }, null)).toBe('comfort');
  });
  it('query API: пробелы обрезаются, status all не шлётся', () => {
    const api = filtersToApi({ ...DEFAULT_FILTERS, q: '  halo ' }, { limit: 60, offset: 60 });
    expect(api.toString()).toBe('q=halo&sort=completed_at&limit=60&offset=60');
    expect(filtersToApi({ ...DEFAULT_FILTERS, status: 'none' }, { limit: 10, offset: 0 }).get('status')).toBe('none');
  });
  it('query блока хроники', () => {
    expect(blockQuery(['completed', 'dropped'], 'completed_at', ' ', { limit: 300, offset: 0 }).toString())
      .toBe('status=completed%2Cdropped&sort=completed_at&limit=300&offset=0');
    expect(blockQuery(['backlog'], 'last_played', 'x', { limit: 12, offset: 0 }).get('q')).toBe('x');
  });
  it('активные фильтры, режим хроники, вкладка статуса', () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, q: ' ' })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, status: 'none' })).toBe(true);
    expect(isChronicleMode(DEFAULT_FILTERS)).toBe(true);
    expect(isChronicleMode({ sort: 'title' })).toBe(false);
    expect(matchesStatusTab(game({ status: null }), 'none')).toBe(true);
    expect(matchesStatusTab(game({ status: 'playing' }), 'none')).toBe(false);
    expect(matchesStatusTab(game({ status: 'playing' }), 'all')).toBe(true);
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
