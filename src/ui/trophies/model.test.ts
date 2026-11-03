import { describe, expect, it } from 'vitest';
import type { FeedItem, FeedResponse } from '@/server/trophies/types';
import { dayLabel, feedUrl, gameLine, groupFeed, mergePages, pageUrl, parsePeriod, summaryParts } from './model';

const item = (id: number, day: string | null, o: Partial<FeedItem> = {}): FeedItem => ({
  id, setId: 1, trophyId: id, type: 'bronze', name: `T${id}`, detail: null, iconUrl: null, earnedAt: day ? `${day}T10:00:00Z` : null, day,
  earnedRate: 10, rarity: 2, setName: 'Set', game: { id: 5, title: 'Game' }, ...o,
});

describe('лента трофеев: модель', () => {
  it('подписи дней', () => {
    expect(dayLabel('2026-11-03', '2026-11-03')).toBe('Сегодня');
    expect(dayLabel('2026-11-02', '2026-11-03')).toBe('Вчера');
    expect(dayLabel('2026-10-26', '2026-11-03')).toBe('Пн, 26 окт.');
    expect(dayLabel('2025-12-31', '2026-01-02')).toBe('Ср, 31 дек. 2025');
    expect(dayLabel(null, '2026-11-03')).toBe('Без даты');
  });
  it('группы по дням, без даты в конце', () => {
    const g = groupFeed([item(1, '2026-11-03'), item(2, '2026-11-03'), item(3, '2026-11-02'), item(4, null)], '2026-11-03');
    expect(g.map((x) => [x.label, x.items.length])).toEqual([['Сегодня', 2], ['Вчера', 1], ['Без даты', 1]]);
  });
  it('сводка', () => {
    expect(summaryParts({ total: 11, platinum: 0, gold: 1, silver: 3, bronze: 7 })).toEqual(['+11', '1 золото', '3 серебра', '7 бронз']);
    expect(summaryParts({ total: 0, platinum: 0, gold: 0, silver: 0, bronze: 0 })).toEqual(['+0']);
  });
  it('адреса', () => {
    expect(feedUrl('7d', false)).toBe('/api/trophies/feed?period=7d');
    expect(feedUrl('all', true, 'n_3')).toBe('/api/trophies/feed?period=all&rare=1&cursor=n_3');
    expect(pageUrl('7d', false)).toBe('/trophies');
    expect(pageUrl('month', true)).toBe('/trophies?period=month&rare=1');
    expect(parsePeriod('x')).toBe('7d');
  });
  it('строка игры и сирота', () => {
    expect(gameLine(item(1, null, { type: 'gold' }))).toBe('Game · золото');
    expect(gameLine(item(1, null, { game: null, setName: '' }))).toBe('Игра вне коллекции · бронза');
  });
  it('склейка страниц без дублей', () => {
    const base = { period: '7d', rare: false, today: '2026-11-03', summary: { total: 3, platinum: 0, gold: 0, silver: 0, bronze: 3 } } as const;
    const a: FeedResponse = { ...base, items: [item(1, '2026-11-03'), item(2, '2026-11-03')], nextCursor: 'x' };
    const b: FeedResponse = { ...base, items: [item(2, '2026-11-03'), item(3, '2026-11-02')], nextCursor: null };
    expect(mergePages(a, b).items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(mergePages(a, b).nextCursor).toBeNull();
  });
});
