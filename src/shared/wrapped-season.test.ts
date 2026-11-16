import { describe, expect, it } from 'vitest';
import { ssrWrappedSeason, wrappedHiddenCookie, wrappedSeason } from './wrapped-season';

const msk = (iso: string) => new Date(`${iso}+03:00`).getTime();

describe('wrappedSeason (П8.4, МСК)', () => {
  it('30 ноября 23:59 МСК ещё не сезон, 1 декабря 00:00 МСК уже итоги года, предварительно', () => {
    expect(wrappedSeason(msk('2026-11-30T23:59:59'))).toBeNull();
    expect(wrappedSeason(msk('2026-12-01T00:00:00'))).toEqual({ year: 2026, preliminary: true });
    // по UTC это ещё 30 ноября: граница именно МСК
    expect(new Date(msk('2026-12-01T00:30:00')).getUTCDate()).toBe(30);
    expect(wrappedSeason(msk('2026-12-01T00:30:00'))).toEqual({ year: 2026, preliminary: true });
  });
  it('31 декабря предварительно, с 1 января МСК итоги прошлого года окончательные, с февраля нет', () => {
    expect(wrappedSeason(msk('2026-12-31T23:59:00'))).toEqual({ year: 2026, preliminary: true });
    expect(wrappedSeason(msk('2027-01-01T00:00:00'))).toEqual({ year: 2026, preliminary: false });
    expect(wrappedSeason(msk('2027-01-31T23:59:00'))).toEqual({ year: 2026, preliminary: false });
    expect(wrappedSeason(msk('2027-02-01T00:00:00'))).toBeNull();
  });
  it('без времени null', () => {
    expect(wrappedSeason(0)).toBeNull();
    expect(wrappedSeason(Number.NaN)).toBeNull();
  });
  it('сервер: cookie «закрыт» гасит только свой год', () => {
    const dec = msk('2026-12-10T12:00:00');
    expect(ssrWrappedSeason(undefined, dec)).toEqual({ year: 2026, preliminary: true });
    expect(ssrWrappedSeason('2026', dec)).toBeNull();
    expect(ssrWrappedSeason('2025', dec)).toEqual({ year: 2026, preliminary: true });
    expect(ssrWrappedSeason(undefined, msk('2026-11-10T12:00:00'))).toBeNull();
    expect(wrappedHiddenCookie(2026)).toBe('ps-wbh=2026; path=/; max-age=31536000; samesite=lax');
  });
});
