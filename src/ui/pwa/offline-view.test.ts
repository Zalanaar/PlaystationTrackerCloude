import { describe, expect, it } from 'vitest';
import type { OfflineGame, OfflineSnapshot } from '@/shared/offline-snapshot';
import { asOfLabel, backlogView, filterCounts, filterGames, hoursText, planRangeText, planSummary, tabFromPath, trophiesText } from './offline-view';
import { needsRefresh } from './offline-data';

const g = (id: number, o: Partial<OfflineGame> = {}): OfflineGame => ({
  id, title: `G${id}`, coverUrl: null, platform: 'PS5', status: null, hours: 0, lastPlayedAt: null, completedAt: null, trophies: null, durationHours: null, ...o,
});
const snap = (o: Partial<OfflineSnapshot> = {}): OfflineSnapshot => ({
  v: 1, generatedAt: '2026-11-16T07:52:00.000Z', profileId: 1, onlineId: 'Zal',
  totals: { games: 0, hours: 0, trophiesEarned: 0, platinumEarned: 0 }, counts: { playing: 0, completed: 0, dropped: 0, backlog: 0, shelved: 0 },
  games: [], backlog: [], stats: { year: 2026, completed: 0, dropped: 0, hours: null, platinum: 0, hoursByMonth: Array(12).fill(null), topByHours: [] }, ...o,
});

describe('офлайн-просмотр (пакет 7, п. 2)', () => {
  it('вкладка по адресу', () => {
    expect(tabFromPath('/')).toBe('collection');
    expect(tabFromPath('/backlog')).toBe('backlog');
    expect(tabFromPath('/roadmap')).toBe('plan');
    expect(tabFromPath('/roadmap/2026')).toBe('plan');
    expect(tabFromPath('/stats')).toBe('stats');
    expect(tabFromPath('/trophies')).toBe('collection');
  });
  it('«Данные от …» в поясе устройства, другой год с годом', () => {
    const now = Date.parse('2026-11-16T10:00:00Z');
    expect(asOfLabel('2026-11-16T07:52:00.000Z', now, 'Europe/Vilnius')).toBe('Данные от 16 нояб., 09:52');
    expect(asOfLabel('2026-11-16T07:52:00.000Z', now, 'Europe/Moscow')).toBe('Данные от 16 нояб., 10:52');
    expect(asOfLabel('2025-12-31T22:30:00.000Z', now, 'Europe/Vilnius')).toBe('Данные от 1 янв., 00:30');
    expect(asOfLabel('2025-05-03T10:00:00.000Z', now, 'UTC')).toBe('Данные от 3 мая 2025, 10:00');
    expect(asOfLabel('мусор', now)).toBe('Данные от неизвестной даты');
  });
  it('часы и трофеи', () => {
    expect(hoursText(7.25)).toBe('7 ч 15 м');
    expect(hoursText(12.6)).toBe('12 ч 36 м');
    expect(hoursText(502.2)).toBe('502 ч');
    expect(hoursText(null)).toBe('—');
    expect(trophiesText([3, 10, false])).toBe('3/10');
    expect(trophiesText([10, 10, true])).toBe('10/10 · платина');
    expect(trophiesText([0, 0, false])).toBeNull();
  });
  it('фильтр статусов: «Все» без сервисов', () => {
    const list = [g(1, { status: 'playing' }), g(2, { status: 'service' }), g(3), g(4, { status: 'backlog' })];
    expect(filterCounts(list)).toMatchObject({ all: 3, playing: 1, backlog: 1, service: 1, none: 1 });
    expect(filterGames(list, 'all').map((x) => x.id)).toEqual([1, 3, 4]);
    expect(filterGames(list, 'backlog').map((x) => x.id)).toEqual([4]);
  });
  it('бэклог в сохранённом порядке, сумма известных длительностей', () => {
    const s = snap({ games: [g(1, { durationHours: 10 }), g(2), g(3, { durationHours: 2.5 })], backlog: [3, 2, 1, 99] });
    const v = backlogView(s);
    expect(v.items.map((x) => x.id)).toEqual([3, 2, 1]);
    expect(v.knownHours).toBe(12.5);
    expect(v.unknown).toBe(1);
  });
  it('подписи плана: период и сводка', () => {
    expect(planRangeText('2026-11-16', '2026-11-30')).toBe('16 нояб. – 30 нояб.');
    expect(planRangeText('2026-11-16', '2026-11-16')).toBe('16 нояб.');
    expect(planSummary({ year: 2026, status: 'no_budget', hoursPerWeek: null, capacityHours: 0, plannedHours: 0, items: [], notFit: 0 })).toBe('Игр в плане нет · бюджет не задан');
    expect(planSummary({
      year: 2026, status: 'ok', hoursPerWeek: 10, capacityHours: 520, plannedHours: 20, notFit: 0,
      items: [{ title: 'GTA VI', coverUrl: null, start: '2026-12-05', end: '2026-12-18', hours: 20, kind: 'release' }],
    })).toBe('1 игра · 20 ч из 520 ч');
  });
  it('обновление копии: нет копии, другой профиль, старше 10 минут', () => {
    const now = Date.parse('2026-11-16T08:00:00Z');
    expect(needsRefresh(null, 1, now)).toBe(true);
    expect(needsRefresh(snap(), 2, now)).toBe(true);
    expect(needsRefresh(snap({ generatedAt: '2026-11-16T07:55:00Z' }), 1, now)).toBe(false);
    expect(needsRefresh(snap({ generatedAt: '2026-11-16T07:49:00Z' }), 1, now)).toBe(true);
  });
});
