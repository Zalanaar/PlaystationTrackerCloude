import { describe, expect, it } from 'vitest';
import type { GameItem } from '@/server/collection/types';
import {
  DEFAULT_FILTERS, filtersDot, adjustCounts, applyPlatinum, hasPlatinum, applyStatusLocally, completionInfo, blockQuery, dateInputToIso, effectiveView, filtersToApi,
  filtersToUrl, hasActiveFilters, isChronicleMode, isoToDateInput, isResetWord, matchesStatusTab, parseFilters, removeFromCounts, resetFilters,
} from './filters';

const p = (s: string) => new URLSearchParams(s);
const game = (o: Partial<GameItem> = {}): GameItem => ({
  id: 1, title: 'X', coverUrl: null, platform: 'PS5', playSeconds: 0, hours: 0, playCount: 0, lastPlayedAt: '2026-10-05T18:42:11.000Z',
  status: null, completedAt: null, droppedAt: null, trophies: null, genres: [], bannerUrl: null, hiddenAt: null, ...o,
});

describe('фильтры <-> URL', () => {
  it('пустой URL = умолчания (сортировка по дате завершения, вид не задан)', () => {
    expect(parseFilters(p(''))).toEqual(DEFAULT_FILTERS);
    expect(DEFAULT_FILTERS.sort).toBe('completed_at');
    expect(DEFAULT_FILTERS.view).toBeNull();
  });
  it('круг: разбор и сборка', () => {
    const f = parseFilters(p('status=completed&sort=hours&order=asc&q=halo&view=dense'));
    expect(f).toEqual({ status: 'completed', sort: 'hours', order: 'asc', q: 'halo', view: 'dense', hidden: false, platinum: false });
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
  it('раздел «Скрытые»: hidden=1 в URL, hidden=only в API, без хроники, «Сбросить» его не снимает', () => {
    const f = parseFilters(p('hidden=1&q=halo'));
    expect(f.hidden).toBe(true);
    expect(parseFilters(p('hidden=yes')).hidden).toBe(false);
    expect(filtersToUrl(f).toString()).toBe('q=halo&hidden=1');
    expect(filtersToApi(f, { limit: 60, offset: 0 }).get('hidden')).toBe('only');
    expect(filtersToApi(DEFAULT_FILTERS, { limit: 60, offset: 0 }).has('hidden')).toBe(false);
    expect(isChronicleMode(f)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, hidden: true })).toBe(false);
    expect(resetFilters(f)).toEqual({ ...f, q: '', status: 'all' });
  });
  it('чип «Платина»: ?platinum=1, комбинируется по И, сброс снимает, не уходит в API', () => {
    const f = parseFilters(p('status=completed&platinum=1'));
    expect(f.platinum).toBe(true);
    expect(parseFilters(p('platinum=yes')).platinum).toBe(false);
    expect(filtersToUrl(f).toString()).toBe('status=completed&platinum=1');
    expect(filtersToApi(f, { limit: 60, offset: 0 }).has('platinum')).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, platinum: true })).toBe(true);
    expect(resetFilters(f)).toEqual({ ...f, status: 'all', platinum: false });
    expect(resetFilters({ ...DEFAULT_FILTERS, hidden: true, platinum: true })).toEqual({ ...DEFAULT_FILTERS, hidden: true });
  });
  it('applyPlatinum: только platinumEarned, без чипа список как есть', () => {
    const t = (platinumEarned: boolean) => ({ earned: 1, defined: 2, progress: 50, platinumDefined: true, platinumEarned, byType: { platinum: { earned: 0, defined: 1 }, gold: { earned: 0, defined: 0 }, silver: { earned: 0, defined: 0 }, bronze: { earned: 0, defined: 0 } } });
    const list = [game({ id: 1, trophies: t(true) }), game({ id: 2, trophies: t(false) }), game({ id: 3, trophies: null })];
    expect(applyPlatinum(list, true).map((g) => g.id)).toEqual([1]);
    expect(applyPlatinum(list, false).map((g) => g.id)).toEqual([1, 2, 3]);
    expect(hasPlatinum(list[2])).toBe(false);
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
    const c = { all: 3, playing: 1, completed: 0, dropped: 0, backlog: 0, shelved: 0, service: 0, none: 2 };
    expect(adjustCounts(c, null, 'completed')).toEqual({ ...c, completed: 1, none: 1 });
    expect(adjustCounts(c, 'playing', null)).toEqual({ ...c, playing: 0, none: 3 });
    expect(adjustCounts({ ...c, none: 2 }, null, 'service')).toEqual({ ...c, service: 1, none: 1 });
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

describe('счётчики при скрытии', () => {
  const c = { all: 3, playing: 1, completed: 0, dropped: 0, backlog: 0, shelved: 0, service: 0, none: 2 };
  it('минус один в статусе и во «Все», не ниже нуля', () => {
    expect(removeFromCounts(c, null)).toEqual({ ...c, all: 2, none: 1 });
    expect(removeFromCounts(c, 'playing')).toEqual({ ...c, all: 2, playing: 0 });
    expect(removeFromCounts(c, 'completed').completed).toBe(0);
  });
});

describe('подтверждение сброса всех статусов', () => {
  it('слово СБРОС без учёта регистра и пробелов, остальное нет', () => {
    expect(isResetWord('СБРОС')).toBe(true);
    expect(isResetWord('  сброс ')).toBe(true);
    expect(isResetWord('RESET')).toBe(false);
    expect(isResetWord('СБРО')).toBe(false);
    expect(isResetWord('')).toBe(false);
  });
});

describe('точка на кнопке «Фильтры» (моб.)', () => {
  const base = { sort: 'completed_at' as const, status: 'all' as const, platinum: false };
  it('по умолчанию нет', () => expect(filtersDot(base, 'comfort')).toBe(false));
  it('сортировка, статус, платина, вид', () => {
    expect(filtersDot({ ...base, sort: 'title' }, 'comfort')).toBe(true);
    expect(filtersDot({ ...base, status: 'playing' }, 'comfort')).toBe(true);
    expect(filtersDot({ ...base, platinum: true }, 'comfort')).toBe(true);
    expect(filtersDot(base, 'dense')).toBe(true);
    expect(filtersDot(base, 'list')).toBe(true);
  });
});
