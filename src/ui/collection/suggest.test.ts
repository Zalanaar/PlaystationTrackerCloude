import { describe, expect, it } from 'vitest';
import type { SearchCandidate } from './manual';
import { visibleManual, type ManualGame } from './manual';
import {
  FALLBACK_BLOCK_MS, SUGGEST_MIN, cacheKey, classifySuggestError, createGuard, enterWithoutActive, filterByTitle, guardedState, highlightParts, hintText,
  liveText, matchesQuery, mergeLocal, moveActive, storeStateFor, suggestQuery,
} from './suggest';

const c = (id: string): SearchCandidate => ({ externalSource: 'rawg', externalId: id, title: `Игра ${id}`, releaseDate: null, coverUrl: null, platforms: [], playstation: true, duplicate: null, inBacklog: false });
const err = (status: number, code: string, details?: unknown) => ({ status, code, details });

describe('фильтр списка и запрос', () => {
  it('подстрока без регистра и без различия ё/е', () => {
    expect(matchesQuery('Ёжик в тумане', 'ежик')).toBe(true);
    expect(matchesQuery('HADES II', 'hades')).toBe(true);
    expect(matchesQuery('Hades', 'zzz')).toBe(false);
    expect(matchesQuery('Hades', '   ')).toBe(false);
  });
  it('нормализация: пробелы схлопываются, длина не больше 80', () => {
    expect(suggestQuery('  God   of  War ')).toBe('God of War');
    expect(suggestQuery('a'.repeat(100))).toHaveLength(80);
    expect(cacheKey('God  of WAR')).toBe(cacheKey(' god of war '));
  });
  it('filterByTitle: пустой запрос оставляет всё', () => {
    const l = [{ title: 'Alpha' }, { title: 'Beta' }];
    expect(filterByTitle(l, 'alp')).toEqual([{ title: 'Alpha' }]);
    expect(filterByTitle(l, '')).toHaveLength(2);
  });
  it('visibleManual: q сужает записи «не куплено» локально', () => {
    const g = (id: number, title: string, nb: boolean) => ({ id, title, notPurchased: nb }) as ManualGame;
    const items = [g(1, 'Hades II', true), g(2, 'Control', true), g(3, 'Hades', false)];
    const f = { genres: [], duration: [], hltb: [], nb: false };
    expect(visibleManual(items, { ...f, q: 'hades' }).map((x) => x.id)).toEqual([1, 3]);
    expect(visibleManual(items, { ...f, nb: true, q: 'hades' }).map((x) => x.id)).toEqual([1]);
    expect(visibleManual(items, f)).toHaveLength(3);
  });
});

describe('подсветка совпадения', () => {
  it('подсвечиваются все вхождения слов запроса', () => {
    const p = highlightParts('Hades II: Hades', 'hades');
    expect(p.filter((x) => x.hit).map((x) => x.text)).toEqual(['Hades', 'Hades']);
    expect(p.map((x) => x.text).join('')).toBe('Hades II: Hades');
  });
  it('ё/е и регистр не различаются; не больше 3 слов', () => {
    expect(highlightParts('Ёжик Ёж', 'еж').filter((x) => x.hit).map((x) => x.text)).toEqual(['Ёж', 'Ёж']);
    const p = highlightParts('a b c d', 'a b c d');
    expect(p.filter((x) => x.hit).map((x) => x.text).join('')).toBe('abc');
  });
  it('пустой запрос и нет совпадения = без подсветки', () => {
    expect(highlightParts('Hades', '')).toEqual([{ text: 'Hades', hit: false }]);
    expect(highlightParts('Hades', 'xyz')).toEqual([{ text: 'Hades', hit: false }]);
  });
});

describe('состояния секции магазина', () => {
  it('меньше 3 символов: подсказка «Введи ещё N»; без ввода idle', () => {
    expect(storeStateFor(0, null, 5)).toEqual({ kind: 'idle' });
    expect(storeStateFor(1, null, 5)).toEqual({ kind: 'hint', len: 1 });
    expect(storeStateFor(SUGGEST_MIN - 1, [], 5)).toEqual({ kind: 'hint', len: 2 });
    expect(hintText(1)).toBe('Введи ещё 2 символа для поиска в магазине PS');
    expect(hintText(2)).toBe('Введи ещё 1 символ для поиска в магазине PS');
  });
  it('3+ символов: загрузка, результаты (не больше max), пусто', () => {
    expect(storeStateFor(3, null, 5)).toEqual({ kind: 'loading' });
    const s = storeStateFor(5, ['1', '2', '3', '4', '5', '6', '7'].map(c), 5);
    expect(s.kind === 'results' && s.items.length).toBe(5);
    const wide = storeStateFor(5, ['1', '2', '3', '4', '5', '6', '7'].map(c), 8);
    expect(wide.kind === 'results' && wide.items.length).toBe(7);
    expect(storeStateFor(5, [], 5)).toEqual({ kind: 'empty' });
  });
  it('разбор отказов подсказок (43.1.3)', () => {
    expect(classifySuggestError(err(429, 'rate_limited', { reason: 'suggest_limited', resetAt: 'X' }), true)).toEqual({ kind: 'limited', resetAt: 'X' });
    expect(classifySuggestError(err(429, 'rate_limited', { reason: 'quota', resetAt: 'Y' }), true)).toEqual({ kind: 'quota', resetAt: 'Y' });
    expect(classifySuggestError(err(503, 'catalog_unavailable', { reason: 'no_key' }), true)).toEqual({ kind: 'hidden' });
    expect(classifySuggestError(err(503, 'catalog_unavailable', { reason: 'rate_limited', resetAt: 'Z' }), true)).toEqual({ kind: 'quota', resetAt: 'Z' });
    expect(classifySuggestError(err(503, 'catalog_unavailable', { reason: 'timeout' }), true)).toEqual({ kind: 'error' });
    expect(classifySuggestError(err(500, 'internal'), true)).toEqual({ kind: 'error' });
    expect(classifySuggestError(err(0, 'network'), false)).toEqual({ kind: 'offline' });
    expect(classifySuggestError(new Error('x'), true)).toEqual({ kind: 'error' });
  });
  it('Enter без активной опции: при мягком пределе открывает поиск в магазине, иначе фильтр', () => {
    expect(enterWithoutActive({ kind: 'limited' })).toBe('store');
    expect(enterWithoutActive({ kind: 'quota', resetAt: null })).toBe('filter');
    expect(enterWithoutActive({ kind: 'idle' })).toBe('filter');
  });
  it('живая область: один текст после устоявшихся источников', () => {
    expect(liveText(2, { kind: 'results', items: [c('1'), c('2'), c('3'), c('4'), c('5')] })).toBe('Из списка: 2. Из магазина PS: 5.');
    expect(liveText(0, { kind: 'empty' })).toBe('Ничего не найдено');
    expect(liveText(0, { kind: 'limited' })).toBe('Подсказки из магазина недоступны');
    expect(liveText(1, { kind: 'quota', resetAt: null })).toBe('Из списка: 1. Подсказки из магазина недоступны.');
    expect(liveText(1, { kind: 'loading' })).toBe('');
  });
});

describe('блокировки до resetAt', () => {
  const now = Date.parse('2026-11-02T12:00:00.000Z');
  it('мягкий предел отключает автоподсказки до resetAt, потом снимается', () => {
    const g = createGuard();
    g.limit('2026-11-02T21:00:00.000Z', now);
    expect(g.status(now).limited).toBe(true);
    expect(g.status(now).quota).toBe(false);
    expect(guardedState(g.status(now))).toEqual({ kind: 'limited' });
    expect(g.status(Date.parse('2026-11-02T21:00:01.000Z')).limited).toBe(false);
  });
  it('квота останавливает и подсказки, и Enter-поиск (quota) до resetAt', () => {
    const g = createGuard();
    g.quota('2026-11-02T21:00:00.000Z', now);
    expect(g.status(now)).toMatchObject({ quota: true, quotaResetAt: '2026-11-02T21:00:00.000Z' });
    expect(guardedState(g.status(now))).toEqual({ kind: 'quota', resetAt: '2026-11-02T21:00:00.000Z' });
    expect(g.status(Date.parse('2026-11-03T00:00:00.000Z')).quota).toBe(false);
  });
  it('нет resetAt или он в прошлом: запасной срок', () => {
    const g = createGuard();
    g.limit(null, now);
    expect(g.status(now + FALLBACK_BLOCK_MS - 1).limited).toBe(true);
    expect(g.status(now + FALLBACK_BLOCK_MS + 1).limited).toBe(false);
    g.quota('2000-01-01T00:00:00.000Z', now);
    expect(g.status(now).quota).toBe(true);
  });
  it('каталог не настроен прячет секцию; reset снимает всё', () => {
    const g = createGuard();
    g.unavailable();
    expect(guardedState(g.status(now))).toEqual({ kind: 'hidden' });
    g.reset();
    expect(guardedState(g.status(now))).toBeNull();
  });
});

describe('клавиатура и локальные опции', () => {
  it('стрелки не зацикливаются', () => {
    expect(moveActive(-1, 3, 1)).toBe(0);
    expect(moveActive(0, 3, 1)).toBe(1);
    expect(moveActive(2, 3, 1)).toBe(2);
    expect(moveActive(0, 3, -1)).toBe(0);
    expect(moveActive(-1, 3, -1)).toBe(-1);
    expect(moveActive(-1, 0, 1)).toBe(-1);
  });
  it('mergeLocal: не больше max, обе группы получают место', () => {
    const lib = [1, 2, 3, 4, 5, 6];
    const man = ['a', 'b', 'c'];
    const m = mergeLocal(lib, man, 5);
    expect(m.lib.length + m.man.length).toBe(5);
    expect(m.man.length).toBeGreaterThan(0);
    expect(m.lib.length).toBeGreaterThan(0);
    expect(mergeLocal([1], ['a'], 5)).toEqual({ lib: [1], man: ['a'] });
    expect(mergeLocal(lib, [], 5).lib).toHaveLength(5);
  });
});
