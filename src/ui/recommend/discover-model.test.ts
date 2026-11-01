import { describe, expect, it } from 'vitest';
import { discoverView, pageHref, parseTab, pickedText, releaseYear, scoreLine } from './discover-model';

describe('discover-model', () => {
  it('вкладка и адрес', () => {
    expect(parseTab('discover')).toBe('discover');
    expect(parseTab('x')).toBe('backlog');
    expect(parseTab(null)).toBe('backlog');
    expect(pageHref('discover', 'short')).toBe('/recommend?tab=discover');
    expect(pageHref('backlog', 'short')).toBe('/recommend?time=short');
    expect(pageHref('backlog', 'any')).toBe('/recommend');
  });
  it('год и рейтинг', () => {
    expect(releaseYear('2019-05-05')).toBe('2019');
    expect(releaseYear(null)).toBeNull();
    expect(scoreLine(91, 4.3)).toBe('Metacritic 91 · Пользователи ★ 4,3');
    expect(scoreLine(null, 4)).toBe('Пользователи ★ 4,0');
    expect(scoreLine(null, null)).toBeNull();
  });
  it('дата подборки по Москве', () => {
    expect(pickedText('2026-10-31T21:30:00Z')).toBe('Подборка от 1 ноября');
    expect(pickedText(null)).toBeNull();
  });
  it('вид', () => {
    const m = (catalog: string, reason: string | null) => ({ catalog, reason });
    expect(discoverView({ items: [1], meta: m('ok', null) })).toBe('cards');
    expect(discoverView({ items: [], meta: m('unavailable', null) })).toBe('catalog');
    expect(discoverView({ items: [], meta: m('ok', 'not_generated') })).toBe('not_generated');
    expect(discoverView({ items: [], meta: m('ok', 'no_candidates') })).toBe('no_candidates');
  });
});
