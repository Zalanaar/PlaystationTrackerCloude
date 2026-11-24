import { describe, expect, it } from 'vitest';
import { inUpcomingWindow, sortUpcomingByDate, upcomingWindowEnd, UPCOMING_WINDOW_DAYS } from './upcoming-catalog';

describe('окно и сортировка предстоящих релизов', () => {
  it('конец окна: 30 окт. 2026 + 365 = 30 окт. 2027', () => {
    expect(UPCOMING_WINDOW_DAYS).toBe(365);
    expect(upcomingWindowEnd('2026-10-30')).toBe('2027-10-30');
  });

  it('границы входят, TBA и 2028 — нет', () => {
    const from = '2026-11-24';
    const to = upcomingWindowEnd(from);
    expect(inUpcomingWindow(from, from, to)).toBe(true);
    expect(inUpcomingWindow(to, from, to)).toBe(true);
    expect(inUpcomingWindow('2026-11-23', from, to)).toBe(false);
    expect(inUpcomingWindow('2027-10-31', from, '2027-11-24')).toBe(true);
    expect(inUpcomingWindow('2028-12-03', from, to)).toBe(false);
    expect(inUpcomingWindow(null, from, to)).toBe(false);
  });

  it('сортирует по дате, затем по id; без даты в конце', () => {
    const rows = [
      { externalId: 'b', releaseDate: '2027-04-08' },
      { externalId: 'a', releaseDate: '2027-01-12' },
      { externalId: 'c', releaseDate: '2027-04-08' },
      { externalId: 'z', releaseDate: null },
    ];
    expect(sortUpcomingByDate(rows).map((r) => r.externalId)).toEqual(['a', 'b', 'c', 'z']);
    expect(sortUpcomingByDate([
      { externalId: '10', releaseDate: '2027-05-31' },
      { externalId: '9', releaseDate: '2027-05-31' },
    ]).map((r) => r.externalId)).toEqual(['9', '10']);
  });
});
