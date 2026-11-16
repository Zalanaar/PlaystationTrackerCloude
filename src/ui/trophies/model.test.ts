import { describe, expect, it } from 'vitest';
import type { FeedItem, FeedResponse, NearListItem } from '@/server/trophies/types';
import { dayLabel, feedUrl, gameLine, groupFeed, mergePages, nearPageUrl, nearSummary, pageUrl, parseNearSort, platinumRateText, sortNear, collapseRuns, runLine, runRarest, parsePeriod, parseView, summaryParts, viewUrl } from './model';

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

describe('Пакет 6, п. 9: «Почти платина»', () => {
  it('parseView / viewUrl / nearSummary', () => {
    const m = { parseView, viewUrl, nearSummary };
    expect(m.parseView('near')).toBe('near');
    expect(m.parseView(undefined)).toBe('feed');
    expect(m.parseView(['near'])).toBe('feed');
    expect(m.viewUrl('near', 'all', true)).toBe('/trophies?view=near');
    expect(m.viewUrl('feed', 'all', true)).toBe('/trophies?period=all&rare=1');
    expect(m.viewUrl('feed', '7d', false)).toBe('/trophies');
    expect(m.nearSummary(1)).toBe('1 игра с прогрессом к платине');
    expect(m.nearSummary(3)).toBe('3 игры с прогрессом к платине');
    expect(m.nearSummary(12)).toBe('12 игр с прогрессом к платине');
  });
});


describe('П12.1 лёгкие платины', () => {
  const it0 = (title: string, rate: number | null, remaining: number, progress: number): NearListItem => ({
    gameId: title.length, title, coverUrl: null,
    forecast: { setId: 1, required: 50, earned: 50 - remaining, progress, remaining: { gold: 0, silver: 0, bronze: remaining, total: remaining }, remainingHidden: 0, avgEarnedRate: null, minEarnedRate: null, ratesKnown: 0, platinumEarnedRate: rate },
  });
  const list = [it0('A', 4.3, 2, 96), it0('B', 40, 20, 60), it0('C', null, 1, 98), it0('D', 40, 5, 90), it0('E', null, 10, 80)];
  it('«Ближе всего» — порядок сервера', () => {
    expect(sortNear(list, 'close').map((i) => i.title)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
  it('«Лёгкие»: доля игроков с платиной, затем остаток; без процента в конце', () => {
    expect(sortNear(list, 'easy').map((i) => i.title)).toEqual(['D', 'B', 'A', 'C', 'E']);
    expect(list.map((i) => i.title)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
  it('адрес и разбор параметра', () => {
    expect(parseNearSort('easy')).toBe('easy');
    expect(parseNearSort(['easy'])).toBe('close');
    expect(parseNearSort(undefined)).toBe('close');
    expect(nearPageUrl('easy')).toBe('/trophies?view=near&sort=easy');
    expect(nearPageUrl('close')).toBe('/trophies?view=near');
  });
  it('подпись доли', () => {
    expect(platinumRateText(42.13)).toBe('платина у 42,1% игроков');
    expect(platinumRateText(null)).toBeNull();
  });
});

describe('П12.2 свёртка серии', () => {
  const t = (id: number, setId: number, type: FeedItem['type'] = 'bronze', rate: number | null = 50) => item(id, '2026-11-10', { setId, type, earnedRate: rate, setName: `Set ${setId}`, game: { id: setId, title: `Игра ${setId}` } });
  it('3+ подряд одного сета — серия; меньше — по одной; платина отдельно и рвёт серию', () => {
    const e = collapseRuns([t(1, 1), t(2, 1), t(3, 1, 'gold'), t(4, 2), t(5, 2), t(6, 1, 'platinum'), t(7, 1), t(8, 1), t(9, 1)]);
    expect(e.map((x) => (x.kind === 'run' ? `run:${x.items.map((i) => i.id).join(',')}` : x.item.id))).toEqual(['run:1,2,3', 4, 5, 6, 'run:7,8,9']);
    const r = e[0];
    expect(r.kind === 'run' && r.title).toBe('Игра 1');
    expect(r.kind === 'run' && r.key).toBe('run-1');
  });
  it('подпись и самый редкий', () => {
    const items = [t(1, 1, 'gold', 30), t(2, 1, 'bronze', 4.2), t(3, 1, 'bronze', null)];
    expect(runLine(items)).toBe('3 трофея · 1 золото · 2 бронзы');
    expect(runRarest(items).id).toBe(2);
  });
});
