import { describe, expect, it } from 'vitest';
import { calcInboxHours, countByWindow, inWindow, isInboxEmpty, weekRanges, windowSince, type InboxParts } from './calc';

const NOW = new Date('2026-11-01T12:00:00Z');
const zero: InboxParts = {
  newGames: { newGames: 0, newGamesWindow: null, newUnsorted: 0 },
  trophies: { trophies: 0, platinums: 0, trophiesWindow: null },
  hours: { hoursWeek: 0, hoursPrevWeek: 0, hoursNoHistory: false },
  checkCount: 0,
  forgottenCount: 0,
};
const hAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('окна', () => {
  it('граница: since исключена, now включён', () => {
    const since = windowSince('24h', NOW);
    expect(since.toISOString()).toBe('2026-10-31T12:00:00.000Z');
    expect(inWindow(since, since, NOW)).toBe(false);
    expect(inWindow(new Date(since.getTime() + 1), since, NOW)).toBe(true);
    expect(inWindow(NOW, since, NOW)).toBe(true);
    expect(inWindow(new Date(NOW.getTime() + 1), since, NOW)).toBe(false);
    expect(inWindow(null, since, NOW)).toBe(false);
    expect(windowSince('7d', NOW).toISOString()).toBe('2026-10-25T12:00:00.000Z');
  });
  it('24h, если есть события, иначе 7d, иначе null', () => {
    expect(countByWindow([hAgo(1), hAgo(30)], NOW)).toEqual({ h24: 1, d7: 2, window: '24h' });
    expect(countByWindow([hAgo(24), hAgo(30)], NOW)).toEqual({ h24: 0, d7: 2, window: '7d' });
    expect(countByWindow([hAgo(168), null], NOW)).toEqual({ h24: 0, d7: 0, window: null });
    expect(countByWindow([], NOW).window).toBeNull();
  });
});

describe('недели по МСК и часы', () => {
  it('сегодня по МСК, а не UTC', () => {
    expect(weekRanges(new Date('2026-10-31T21:30:00Z'))).toEqual({ from: '2026-10-26', to: '2026-11-01', prevFrom: '2026-10-19', prevTo: '2026-10-25' });
    expect(weekRanges(new Date('2026-10-31T20:59:00Z')).to).toBe('2026-10-31');
  });
  it('дельта снимков за две недели', () => {
    const snaps = [
      { gameId: 1, date: '2026-10-18', seconds: 3600 },
      { gameId: 1, date: '2026-10-25', seconds: 3600 + 7200 },
      { gameId: 1, date: '2026-11-01', seconds: 3600 + 7200 + 3600 },
    ];
    expect(calcInboxHours(snaps, '2026-10-18', NOW)).toEqual({ hoursWeek: 1, hoursPrevWeek: 2, hoursNoHistory: false });
  });
  it('нет снимков: нет истории; первый снимок внутри прошлой недели: прошлая null', () => {
    expect(calcInboxHours([], null, NOW)).toEqual({ hoursWeek: null, hoursPrevWeek: null, hoursNoHistory: true });
    const h = calcInboxHours([{ gameId: 1, date: '2026-10-22', seconds: 100 }, { gameId: 1, date: '2026-11-01', seconds: 3700 }], '2026-10-22', NOW);
    expect(h).toEqual({ hoursWeek: 1, hoursPrevWeek: null, hoursNoHistory: false });
  });
  it('отрицательная дельта = 0', () => {
    expect(calcInboxHours([{ gameId: 1, date: '2026-10-20', seconds: 9000 }, { gameId: 1, date: '2026-11-01', seconds: 100 }], '2026-10-01', NOW).hoursWeek).toBe(0);
  });
});

describe('isEmpty', () => {
  it('пусто', () => expect(isInboxEmpty(zero)).toBe(true));
  it('любая часть > 0 делает полосу непустой', () => {
    expect(isInboxEmpty({ ...zero, newGames: { newGames: 1, newGamesWindow: '24h', newUnsorted: 1 } })).toBe(false);
    expect(isInboxEmpty({ ...zero, forgottenCount: 2 })).toBe(false);
    expect(isInboxEmpty({ ...zero, checkCount: 2 })).toBe(false);
    expect(isInboxEmpty({ ...zero, trophies: { trophies: 1, platinums: 0, trophiesWindow: '7d' } })).toBe(false);
    expect(isInboxEmpty({ ...zero, hours: { hoursWeek: 0.1, hoursPrevWeek: null, hoursNoHistory: false } })).toBe(false);
  });
  it('упавшие части (null) не входят', () => {
    expect(isInboxEmpty({ newGames: null, trophies: null, hours: null, checkCount: null, forgottenCount: null })).toBe(true);
    expect(isInboxEmpty({ ...zero, hours: null, forgottenCount: 1 })).toBe(false);
  });
});
