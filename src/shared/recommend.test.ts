import { describe, expect, it } from 'vitest';
import { DISLIKE_TTL_DAYS, dislikeExpiresAt, isDislikeActive } from './recommend';

describe('DISLIKE_TTL', () => {
  const at = new Date('2026-10-01T00:00:00Z');
  it('30 суток, граница строгая', () => {
    expect(DISLIKE_TTL_DAYS).toBe(30);
    expect(dislikeExpiresAt(at).toISOString()).toBe('2026-10-31T00:00:00.000Z');
    expect(isDislikeActive(at, new Date('2026-10-30T00:00:00Z'))).toBe(true); // 29 сут
    expect(isDislikeActive(at, new Date('2026-10-30T23:59:59Z'))).toBe(true);
    expect(isDislikeActive(at, new Date('2026-10-31T00:00:00Z'))).toBe(false); // ровно 30
    expect(isDislikeActive(at, new Date('2026-11-01T00:00:00Z'))).toBe(false); // 31
  });
});
