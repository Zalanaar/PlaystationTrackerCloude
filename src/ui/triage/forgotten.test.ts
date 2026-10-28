import { describe, expect, it } from 'vitest';
import { FORGOTTEN_DAYS, forgottenChipText, forgottenCountOf, forgottenSpan, isForgotten } from './forgotten';

const NOW = Date.parse('2026-10-28T12:00:00.000Z');
const ago = (days: number, extraMs = 0) => new Date(NOW - days * 86_400_000 - extraMs).toISOString();
const g = (o: Partial<Parameters<typeof isForgotten>[0]> = {}) => ({ status: null, playSeconds: 3600, lastPlayedAt: ago(120), ...o });

describe('isForgotten (контракт 14.4)', () => {
  it('без статуса, играл, не запускалась больше 90 суток', () => {
    expect(isForgotten(g(), NOW)).toBe(true);
  });
  it('граница 90 суток по моменту: ровно 90 нет, на секунду больше да', () => {
    expect(isForgotten(g({ lastPlayedAt: ago(FORGOTTEN_DAYS) }), NOW)).toBe(false);
    expect(isForgotten(g({ lastPlayedAt: ago(FORGOTTEN_DAYS, 1000) }), NOW)).toBe(true);
  });
  it('есть статус, нет часов или нет даты запуска: не забытая', () => {
    expect(isForgotten(g({ status: 'backlog' }), NOW)).toBe(false);
    expect(isForgotten(g({ playSeconds: 0 }), NOW)).toBe(false);
    expect(isForgotten(g({ lastPlayedAt: null }), NOW)).toBe(false);
    expect(isForgotten(g({ lastPlayedAt: 'мусор' }), NOW)).toBe(false);
  });
  it('время ещё не известно (SSR, now = 0): не забытая', () => {
    expect(isForgotten(g(), 0)).toBe(false);
  });
});

describe('срок без запуска', () => {
  it('месяцы и годы', () => {
    expect(forgottenSpan(ago(150), NOW)).toBe('5 мес.');
    expect(forgottenSpan(ago(95), NOW)).toBe('3 мес.');
    expect(forgottenSpan(ago(400), NOW)).toBe('1 г.');
    expect(forgottenSpan(ago(800), NOW)).toBe('2 г.');
    expect(forgottenSpan(ago(10), NOW)).toBeNull();
    expect(forgottenSpan(null, NOW)).toBeNull();
  });
  it('текст чипа', () => {
    expect(forgottenChipText(ago(150), NOW)).toBe('Забытая · не запускалась 5 мес.');
    expect(forgottenChipText(null, NOW)).toBe('Забытая');
  });
  it('forgottenCountOf переживает отсутствие поля', () => {
    expect(forgottenCountOf(23)).toBe(23);
    expect(forgottenCountOf(undefined)).toBe(0);
    expect(forgottenCountOf(-3)).toBe(0);
    expect(forgottenCountOf('5')).toBe(0);
  });
});
