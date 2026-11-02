import { describe, expect, it } from 'vitest';
import { expectHero, heroHintCookie, parseHeroHint } from './heroHint';

describe('heroHint', () => {
  it('parseHeroHint: 1/0, остальное undefined', () => {
    expect(parseHeroHint('1')).toBe(true);
    expect(parseHeroHint('0')).toBe(false);
    expect(parseHeroHint(undefined)).toBeUndefined();
    expect(parseHeroHint('x')).toBeUndefined();
  });
  it('heroHintCookie', () => {
    expect(heroHintCookie(true)).toBe('ps-hero=1; path=/; max-age=31536000; samesite=lax');
    expect(heroHintCookie(false)).toMatch(/^ps-hero=0;/);
  });
  it('expectHero: сводка важнее подсказки', () => {
    expect(expectHero(0, true)).toBe(false);
    expect(expectHero(2, false)).toBe(true);
    expect(expectHero(null, false)).toBe(false);
    expect(expectHero(null, true)).toBe(true);
    expect(expectHero(null, undefined)).toBe(true);
  });
});
