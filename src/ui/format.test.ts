import { describe, expect, it } from 'vitest';
import { cssUrl, formatDate, formatDateLong, formatPlayTime, formatShortDate, isSyncStale, launchesText, plural, relativeAgo, syncAge } from './format';

const NOW = Date.parse('2026-10-27T09:00:00Z');

describe('format', () => {
  it('время игры', () => {
    expect(formatPlayTime(101_853)).toBe('28 ч 17 мин');
    expect(formatPlayTime(360)).toBe('6 мин');
    expect(formatPlayTime(7200)).toBe('2 ч');
    expect(formatPlayTime(0)).toBeNull();
  });
  it('даты по Москве', () => {
    expect(formatDate('2026-10-05T22:30:00Z')).toBe('06.10.2026');
    expect(formatDateLong('2026-10-05T18:42:11Z')).toBe('5 октября 2026 г.');
    expect(formatDate(null)).toBeNull();
    expect(formatShortDate('2026-10-12T10:00:00Z', NOW)).toBe('12 окт.');
    expect(formatShortDate('2025-10-12T10:00:00Z', NOW)).toBe('12.10.2025');
  });
  it('относительные даты', () => {
    expect(relativeAgo('2026-10-27T01:00:00Z', NOW)).toBe('сегодня');
    expect(relativeAgo('2026-10-26T20:59:00Z', NOW)).toBe('вчера');
    expect(relativeAgo('2026-10-22T09:00:00Z', NOW)).toBe('5 дн. назад');
    expect(relativeAgo('2026-10-06T09:00:00Z', NOW)).toBe('3 нед. назад');
    expect(relativeAgo('2026-08-27T09:00:00Z', NOW)).toBe('2 мес. назад');
    expect(relativeAgo('2024-10-01T09:00:00Z', NOW)).toBe('2 г. назад');
  });
  it('возраст синка и протухание', () => {
    expect(syncAge('2026-10-27T06:00:00Z', NOW)).toBe('3 ч назад');
    expect(syncAge('2026-10-27T08:58:00Z', NOW)).toBe('2 мин назад');
    expect(isSyncStale('2026-10-25T09:00:00Z', NOW)).toBe(true);
    expect(isSyncStale('2026-10-26T09:00:00Z', NOW)).toBe(false);
    expect(isSyncStale(null, NOW)).toBe(true);
  });
  it('склонения', () => {
    expect(plural(1, ['запуск', 'запуска', 'запусков'])).toBe('запуск');
    expect(launchesText(19)).toBe('19 запусков');
    expect(launchesText(22)).toBe('22 запуска');
    expect(launchesText(11)).toBe('11 запусков');
  });
  it('cssUrl отбрасывает чужие схемы и кавычки', () => {
    expect(cssUrl('javascript:alert(1)')).toBeUndefined();
    expect(cssUrl('https://a.b/c"d.png')).toBe('url("https://a.b/c%22d.png")');
  });
});
