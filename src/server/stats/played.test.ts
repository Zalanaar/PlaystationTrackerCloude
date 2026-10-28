// Фаза 8.2: «Игры месяца» (контракт 10.1, played). Чистые функции.
import { describe, expect, it } from 'vitest';
import type { GameItem } from '@/server/collection/types';
import { composeStats } from './compose';
import { calcHours, groupSnapshots, type EstimateInput, type Snapshot } from './hours';
import { resolvePeriod } from './period';
import { groupPlayed, playedGameIds } from './played';

const H = 3600;
const game = (id: number, title: string): GameItem => ({
  id, title, coverUrl: null, platform: 'PS5', playSeconds: 0, hours: 0, playCount: 0, lastPlayedAt: null,
  status: null, completedAt: null, droppedAt: null, trophies: null, genres: [], bannerUrl: null, hiddenAt: null,
});
const snap = (gameId: number, date: string, hours: number): Snapshot => ({ gameId, date, seconds: Math.round(hours * H) });
const est = (gameId: number, o: Partial<EstimateInput>): EstimateInput => ({
  gameId, firstSnapshotDate: '2026-03-04', firstSeconds: 0, firstPlayedAt: null, lastPlayedAt: null, ...o,
});

describe('played: игра в каждом месяце, где играли', () => {
  const games = new Map([1, 2, 3, 4].map((id) => [id, game(id, ['Bravo', 'alpha', 'Charlie', 'Delta'][id - 1])]));
  // 1: оценка янв-фев (20 ч), реальные с 04.03: март +3, май +2 (апрель пусто)
  // 2: только реальные: март +1, октябрь +4; завершена в октябре
  // 3: брошена в апреле, часов нет
  // 4: снимки есть, но время не росло
  const snapshots: Snapshot[] = [
    snap(1, '2026-03-04', 20), snap(1, '2026-03-20', 23), snap(1, '2026-04-30', 23), snap(1, '2026-05-10', 25),
    snap(2, '2026-03-04', 5), snap(2, '2026-03-30', 6), snap(2, '2026-10-05', 10),
    snap(4, '2026-03-04', 7), snap(4, '2026-06-01', 7),
  ];
  const estimates = [
    est(1, { firstSeconds: 20 * H, firstPlayedAt: new Date('2026-01-10T12:00:00Z'), lastPlayedAt: new Date('2026-02-20T12:00:00Z') }),
  ];
  const finishedEvents = [
    { gameId: 2, kind: 'completed' as const, at: new Date('2026-10-05T18:00:00Z') },
    { gameId: 3, kind: 'dropped' as const, at: new Date('2026-03-31T22:00:00Z') }, // 01:00 МСК 1 апреля
  ];
  const by = groupSnapshots(snapshots);
  const yearBlock = groupPlayed({ by, estimates, period: resolvePeriod('year', 2026, null), finishedEvents, gameById: games });
  const year = yearBlock.groups;

  it('месяцы по убыванию, только непустые', () => {
    expect(year.map((g) => g.month)).toEqual(['2026-10', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01']);
  });
  it('игра повторяется по месяцам; часы за месяц, оценка помечена', () => {
    const at = (m: string) => year.find((g) => g.month === m)!;
    expect(at('2026-01').items.map((i) => [i.gameId, i.hours, i.estimated])).toEqual([[1, 10, true]]);
    expect(at('2026-02').items.map((i) => [i.gameId, i.hours, i.estimated])).toEqual([[1, 10, true]]);
    expect(at('2026-03').items.map((i) => [i.gameId, i.hours, i.estimated])).toEqual([[1, 3, false], [2, 1, false]]);
    expect(at('2026-05').items.map((i) => [i.gameId, i.hours])).toEqual([[1, 2]]);
    expect(year.some((g) => g.items.some((i) => i.gameId === 4)), 'нулевой прирост не попадает').toBe(false);
  });
  it('завершение/бросок: в своём месяце, первыми, счётчики ○/✕; брошенная без часов = 0 ч', () => {
    const oct = year[0];
    expect(oct).toMatchObject({ year: 2026, monthNumber: 10, completed: 1, dropped: 0 });
    expect(oct.items[0]).toMatchObject({ hours: 4, finished: 'completed', finishedAt: '2026-10-05T18:00:00.000Z' });
    const apr = year.find((g) => g.month === '2026-04')!;
    expect(apr).toMatchObject({ completed: 0, dropped: 1 });
    expect(apr.items).toEqual([{ gameId: 3, hours: 0, hoursReal: 0, hoursEstimated: 0, estimated: false, finished: 'dropped', finishedAt: '2026-03-31T22:00:00.000Z' }]);
    // в марте игра 2 есть, но не завершена там
    expect(year.find((g) => g.month === '2026-03')!.items.find((i) => i.gameId === 2)?.finished).toBeNull();
  });
  it('сумма секунд месяца совпадает с hours.byMonth (те же слагаемые)', () => {
    const h = calcHours({ by, estimates, period: resolvePeriod('year', 2026, null), year: 2026, firstSnapshotDate: '2026-03-04', today: '2026-10-27' });
    for (const g of year) {
      const sum = Math.round(g.items.reduce((a, i) => a + i.hours, 0) * 10) / 10;
      expect(sum, g.month).toBeCloseTo(h.byMonth[g.monthNumber - 1] ?? 0, 5);
    }
  });
  it('period=month: одна группа или пусто', () => {
    const m = groupPlayed({ by, estimates, period: resolvePeriod('month', 2026, 3), finishedEvents, gameById: games }).groups;
    expect(m.map((g) => g.month)).toEqual(['2026-03']);
    expect(groupPlayed({ by, estimates, period: resolvePeriod('month', 2026, 7), finishedEvents, gameById: games }).groups).toEqual([]);
  });
  it('словарь games: каждая игра один раз, ровно игры блока', () => {
    expect(Object.keys(yearBlock.games).sort()).toEqual(['1', '2', '3']);
    expect(yearBlock.games['1']).toBe(games.get(1));
    const ids = new Set(year.flatMap((g) => [...g.items, ...(g.excluded ?? [])].map((i) => i.gameId)));
    expect([...ids].sort()).toEqual([1, 2, 3]);
    expect(year.every((g) => g.items.every((i) => !('game' in i)))).toBe(true);
  });
  it('playedGameIds: все игры блока одним списком', () => {
    expect(playedGameIds({ by, estimates, period: resolvePeriod('year', 2026, null), finishedEvents }).sort()).toEqual([1, 2, 3]);
  });
  it('январь: база = последний снимок прошлого года (граница года)', () => {
    const b = groupSnapshots([snap(1, '2025-12-30', 10), snap(1, '2026-01-02', 12)]);
    const jan = groupPlayed({ by: b, estimates: [], period: resolvePeriod('year', 2026, null), finishedEvents: [], gameById: games }).groups;
    expect(jan).toHaveLength(1);
    expect(jan[0]).toMatchObject({ month: '2026-01', items: [{ hours: 2 }] });
  });
});

describe('played: порядок внутри месяца', () => {
  it('finished по finishedAt desc, затем часы desc, затем lower(title), id', () => {
    const games = new Map([1, 2, 3, 4, 5].map((id) => [id, game(id, ['b', 'A', 'c', 'a', 'z'][id - 1])]));
    const snapshots = [
      snap(1, '2026-09-30', 0), snap(1, '2026-10-20', 1),
      snap(2, '2026-09-30', 0), snap(2, '2026-10-20', 1),
      snap(3, '2026-09-30', 0), snap(3, '2026-10-20', 5),
      snap(4, '2026-09-30', 0), snap(4, '2026-10-20', 1),
      snap(5, '2026-09-30', 0), snap(5, '2026-10-20', 0.5),
    ];
    const g = groupPlayed({
      by: groupSnapshots(snapshots),
      estimates: [],
      period: resolvePeriod('month', 2026, 10),
      finishedEvents: [
        { gameId: 5, kind: 'completed', at: new Date('2026-10-02T10:00:00Z') },
        { gameId: 1, kind: 'dropped', at: new Date('2026-10-10T10:00:00Z') },
      ],
      gameById: games,
    }).groups;
    expect(g[0].items.map((i) => i.gameId)).toEqual([1, 5, 3, 2, 4]);
    expect(g[0]).toMatchObject({ completed: 1, dropped: 1 });
  });
});

describe('composeStats отдаёт played', () => {
  it('пустой год: played.groups = []', () => {
    const r = composeStats({
      period: resolvePeriod('year', 2025, null), today: '2026-10-27', years: [2026], snapshots: [], estimates: [],
      firstSnapshotDate: null, trophies: [], trophiesByGame: [], finishedEvents: [], gameById: new Map(), genreGames: new Map(),
    });
    expect(r.played).toEqual({ games: {}, groups: [] });
  });
});
