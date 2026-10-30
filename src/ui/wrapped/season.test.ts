import { describe, expect, it } from 'vitest';
import { seasonYear } from './season';

const msk = (iso: string) => new Date(`${iso}+03:00`).getTime();

describe('seasonYear', () => {
  it('декабрь: текущий год', () => expect(seasonYear(msk('2026-12-15T12:00:00'))).toBe(2026));
  it('январь: прошлый год', () => expect(seasonYear(msk('2027-01-10T12:00:00'))).toBe(2026));
  it('граница по МСК: 1 января 00:30 МСК это уже январь', () => expect(seasonYear(msk('2027-01-01T00:30:00'))).toBe(2026));
  it('вне сезона и без времени', () => {
    expect(seasonYear(msk('2026-10-29T12:00:00'))).toBeNull();
    expect(seasonYear(0)).toBeNull();
  });
});
