import { describe, expect, it } from 'vitest';
import { closedHref, gameHref, parseGameParam, parseGameTab } from './gameLink';

describe('parseGameParam', () => {
  it('нет параметра', () => expect(parseGameParam(null)).toEqual({ kind: 'none' }));
  it('положительное целое', () => expect(parseGameParam('42')).toEqual({ kind: 'ok', id: 42 }));
  it.each(['', '0', '-1', '1.5', 'abc', '1e3', ' 5', '007', '99999999999', '2147483648'])('неверный формат %j', (v) => {
    expect(parseGameParam(v)).toEqual({ kind: 'invalid' });
  });
});

describe('parseGameTab', () => {
  it('trophies и всё остальное', () => {
    expect(parseGameTab(new URLSearchParams('tab=trophies'))).toBe('trophies');
    expect(parseGameTab(new URLSearchParams('tab=x'))).toBe('overview');
    expect(parseGameTab(new URLSearchParams(''))).toBe('overview');
  });
});

describe('адреса', () => {
  it('gameHref сохраняет прочие параметры и сбрасывает tab', () => {
    expect(gameHref('?q=god&tab=trophies', 7)).toBe('/?q=god&game=7');
    expect(gameHref('', 7, 'trophies')).toBe('/?game=7&tab=trophies');
  });
  it('closedHref убирает game и tab', () => {
    expect(closedHref('/', '?q=god&game=7&tab=trophies')).toBe('/?q=god');
    expect(closedHref('/', '?game=7')).toBe('/');
  });
});
