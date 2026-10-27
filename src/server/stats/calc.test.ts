import { describe, expect, it } from 'vitest';
import type { GameItem } from '@/server/collection/types';
import { composeStats } from './compose';
import { groupFinished } from './finished';
import { aggregateGenres } from './genre-stats';
import { gameSecondsInRange, groupSnapshots, hasCoverage, hoursByMonth } from './hours';
import { mskDateString, resolvePeriod } from './period';
import { aggregateTrophies } from './trophies';

const H = 3600;
const snap = (date: string, hours: number) => ({ date, seconds: hours * H });

describe('период (МСК)', () => {
  it('год и месяц: границы в UTC', () => {
    const y = resolvePeriod('year', 2026, null);
    expect(y).toMatchObject({ from: '2026-01-01', to: '2026-12-31', fromUtc: '2025-12-31T21:00:00.000Z', toUtc: '2026-12-31T21:00:00.000Z' });
    const m = resolvePeriod('month', 2026, 10);
    expect(m).toMatchObject({ from: '2026-10-01', to: '2026-10-31', fromUtc: '2026-09-30T21:00:00.000Z', toUtc: '2026-10-31T21:00:00.000Z' });
    expect(resolvePeriod('month', 2024, 2).to).toBe('2024-02-29');
  });
  it('дата МСК: 01:00 МСК 1 числа это уже новый месяц', () => {
    expect(mskDateString(new Date('2026-10-31T22:00:00Z'))).toBe('2026-11-01');
    expect(mskDateString(new Date('2026-10-31T20:59:59Z'))).toBe('2026-10-31');
  });
});

describe('часы по снимкам (1.6)', () => {
  const r = (s: { date: string; seconds: number }[], from = '2026-10-01', to = '2026-10-31') => gameSecondsInRange(s, from, to) / H;
  it('нет снимков = 0', () => expect(r([])).toBe(0));
  it('один снимок внутри периода = 0 (нет базы)', () => expect(r([snap('2026-10-10', 50)])).toBe(0));
  it('база до периода: конец минус база', () => {
    expect(r([snap('2026-09-30', 10), snap('2026-10-15', 13), snap('2026-10-31', 15)])).toBe(5);
  });
  it('нет базы: дельта от первого снимка внутри периода', () => {
    expect(r([snap('2026-10-05', 10), snap('2026-10-20', 14)])).toBe(4);
  });
  it('пропуски дней: берётся ближайший снимок, часы не теряются', () => {
    expect(r([snap('2026-08-01', 10), snap('2026-10-31', 16)])).toBe(6);
  });
  it('снимки после периода не влияют', () => {
    expect(r([snap('2026-09-30', 10), snap('2026-10-31', 12), snap('2026-11-01', 20)])).toBe(2);
  });
  it('снижение playDuration = 0, не отрицательное', () => {
    expect(r([snap('2026-09-30', 10), snap('2026-10-31', 7)])).toBe(0);
  });
  it('границы включительно: снимок на from это внутри, на to тоже', () => {
    expect(r([snap('2026-09-30', 10), snap('2026-10-01', 11), snap('2026-10-31', 12)])).toBe(2);
    expect(r([snap('2026-10-01', 10), snap('2026-10-31', 12)])).toBe(2);
  });
  it('граница месяца: часы 01:00 МСК 1 числа (снимок датой 1 ноября) идут в ноябрь', () => {
    const s = [snap('2026-10-31', 10), snap('2026-11-01', 11)];
    expect(r(s, '2026-10-01', '2026-10-31')).toBe(0);
    expect(r(s, '2026-11-01', '2026-11-30')).toBe(1);
  });
  it('groupSnapshots сортирует снимки', () => {
    const by = groupSnapshots([{ gameId: 1, date: '2026-10-02', seconds: 2 }, { gameId: 1, date: '2026-10-01', seconds: 1 }]);
    expect(by.get(1)?.map((x) => x.date)).toEqual(['2026-10-01', '2026-10-02']);
  });
});

describe('охват и помесячные часы', () => {
  const by = groupSnapshots([
    { gameId: 1, date: '2026-03-04', seconds: 10 * H },
    { gameId: 1, date: '2026-03-31', seconds: 12 * H },
    { gameId: 1, date: '2026-04-30', seconds: 15 * H },
    { gameId: 2, date: '2026-04-10', seconds: 5 * H },
    { gameId: 2, date: '2026-04-30', seconds: 6 * H },
  ]);
  it('hasCoverage', () => {
    expect(hasCoverage(null, '2026-01-01', '2026-12-31', '2026-10-27')).toBe(false);
    expect(hasCoverage('2026-03-04', '2026-01-01', '2026-02-28', '2026-10-27')).toBe(false);
    expect(hasCoverage('2026-03-04', '2026-01-01', '2026-03-31', '2026-10-27')).toBe(true);
    expect(hasCoverage('2026-03-04', '2026-11-01', '2026-11-30', '2026-10-27')).toBe(false);
  });
  it('null до первого синка и в будущем, числа между', () => {
    const m = hoursByMonth(by, 2026, '2026-03-04', '2026-05-15');
    expect(m.slice(0, 2)).toEqual([null, null]);
    expect(m[2]).toBe(2); // март: от первого снимка 10 -> 12
    expect(m[3]).toBe(4); // апрель: игра1 +3, игра2 +1
    expect(m[4]).toBe(0); // май идёт, снимков нет = 0, не null
    expect(m.slice(5)).toEqual(Array(7).fill(null));
  });
  it('нет снимков вообще: 12 null', () => {
    expect(hoursByMonth(new Map(), 2026, null, '2026-10-27')).toEqual(Array(12).fill(null));
  });
});

describe('трофеи по earned_at', () => {
  const t = (type: 'platinum' | 'gold' | 'silver' | 'bronze', iso: string | null) => ({ type, earnedAt: iso ? new Date(iso) : null });
  const y = resolvePeriod('year', 2026, null);
  const m = resolvePeriod('month', 2026, 11);
  const list = [
    t('platinum', '2026-06-10T10:00:00Z'),
    t('gold', '2026-10-31T21:59:59Z'), // 00:59:59 МСК 1 ноября
    t('bronze', '2026-10-31T22:00:00Z'), // 01:00 МСК 1 ноября
    t('bronze', '2026-10-31T20:59:59Z'), // 23:59:59 МСК 31 октября
    t('silver', '2025-12-31T21:00:00Z'), // 00:00 МСК 1 января 2026
    t('silver', '2025-12-31T20:59:59Z'), // 2025
    t('bronze', null), // без даты
  ];
  it('год: счётчики и линия', () => {
    const r = aggregateTrophies(list, new Date(y.fromUtc), new Date(y.toUtc), 2026);
    expect(r.counts).toEqual({ platinum: 1, gold: 1, silver: 1, bronze: 2, total: 5 });
    expect(r.byMonth).toHaveLength(12);
    expect(r.byMonth[0]).toMatchObject({ month: 1, silver: 1, total: 1 });
    expect(r.byMonth[10]).toMatchObject({ month: 11, gold: 1, bronze: 1, total: 2 });
    expect(r.byMonth[9]).toMatchObject({ month: 10, bronze: 1, total: 1 });
  });
  it('месяц: граница 01:00 МСК 1 числа', () => {
    const r = aggregateTrophies(list, new Date(m.fromUtc), new Date(m.toUtc), 2026);
    expect(r.counts).toMatchObject({ gold: 1, bronze: 1, total: 2 });
  });
  it('пусто и только без earned_at: нули', () => {
    const r = aggregateTrophies([t('gold', null)], new Date(y.fromUtc), new Date(y.toUtc), 2026);
    expect(r.counts.total).toBe(0);
    expect(r.byMonth.every((x) => x.total === 0)).toBe(true);
  });
});

describe('жанры 1/N', () => {
  const g = (psn: string[] | null, override: string[] | null = null) => ({ psnGenres: psn, genresOverride: override });
  it('нет игр: hasData=false', () => expect(aggregateGenres([])).toEqual({ hasData: false, items: [] }));
  it('игра без жанров = Другое (вес 1)', () => {
    expect(aggregateGenres([g([])]).items).toEqual([{ key: 'OTHER', label: 'Другое', value: 1 }]);
  });
  it('3 жанра: каждому 1/3, сумма = 1', () => {
    const r = aggregateGenres([g(['ACTION', 'ADVENTURE', 'SHOOTER'])]);
    const raw = r.items.map((i) => i.value);
    expect(raw).toEqual([0.3, 0.3, 0.3]);
    const big = aggregateGenres(Array.from({ length: 3 }, () => g(['ACTION', 'ADVENTURE', 'SHOOTER'])));
    expect(big.items.reduce((s, i) => s + i.value, 0)).toBeCloseTo(3, 5);
  });
  it('SIMULATOR=SIMULATION, UNIQUE=Другое, дубли схлопываются', () => {
    const r = aggregateGenres([g(['SIMULATOR', 'SIMULATION']), g(['UNIQUE']), g(['ACTION', 'UNIQUE'])]);
    expect(r.items.find((i) => i.key === 'SIMULATION')?.value).toBe(1);
    expect(r.items.find((i) => i.key === 'OTHER')?.value).toBe(1.5);
    expect(r.items.find((i) => i.key === 'ACTION')?.value).toBe(0.5);
  });
  it('genres_override приоритетнее psn_genres', () => {
    expect(aggregateGenres([g(['ACTION'], ['PUZZLE'])]).items.map((i) => i.key)).toEqual(['PUZZLE']);
  });
  it('топ-8, сортировка по убыванию, затем по ключу', () => {
    const keys = ['ACTION', 'ADVENTURE', 'SHOOTER', 'HORROR', 'RACING', 'FIGHTING', 'ARCADE', 'CASUAL', 'STRATEGY', 'PUZZLE'];
    const list = keys.map((k) => g([k]));
    list.push(g(['PUZZLE']));
    const r = aggregateGenres(list);
    expect(r.items).toHaveLength(8);
    expect(r.items[0]).toMatchObject({ key: 'PUZZLE', value: 2 });
    expect(r.items[1].key).toBe('ACTION');
  });
});

const game = (id: number, title: string): GameItem => ({
  id, title, coverUrl: null, platform: 'PS5', playSeconds: 0, hours: 0, playCount: 0, lastPlayedAt: null,
  status: null, completedAt: null, droppedAt: null, trophies: null, genres: [],
});

describe('пройдено/брошено: группы по месяцам', () => {
  it('группировка по МСК, порядок и пустота', () => {
    const map = new Map([[1, game(1, 'B')], [2, game(2, 'a')], [3, game(3, 'C')]]);
    const groups = groupFinished(
      [
        { gameId: 1, kind: 'completed', at: new Date('2026-10-31T22:00:00Z') }, // ноябрь по МСК
        { gameId: 2, kind: 'dropped', at: new Date('2026-10-31T20:00:00Z') },
        { gameId: 3, kind: 'completed', at: new Date('2026-10-31T22:00:00Z') },
        { gameId: 99, kind: 'completed', at: new Date('2026-10-31T22:00:00Z') }, // игры нет в карте
      ],
      map,
    );
    expect(groups.map((x) => x.month)).toEqual(['2026-11', '2026-10']);
    expect(groups[0].items.map((i) => i.game.title)).toEqual(['B', 'C']);
    expect(groups[1].items[0]).toMatchObject({ kind: 'dropped' });
    expect(groupFinished([], new Map())).toEqual([]);
  });
});

describe('composeStats', () => {
  const base = {
    today: '2026-10-27', years: [2026], snapshots: [], firstSnapshotDate: null, trophies: [], finishedEvents: [],
    gameById: new Map<number, GameItem>(), genreGames: new Map(),
  };
  it('год без данных: 200-форма с пустыми блоками', () => {
    const r = composeStats({ ...base, period: resolvePeriod('year', 2020, null) });
    expect(r.header).toEqual({ completed: 0, dropped: 0, hours: null, platinum: 0 });
    expect(r.hours).toEqual({ byMonth: Array(12).fill(null), firstSnapshotDate: null, periodPartial: true });
    expect(r.genres).toEqual({ hasData: false, items: [] });
    expect(r.trophies.counts.total).toBe(0);
    expect(r.trophies.byMonth).toHaveLength(12);
    expect(r.finished.groups).toEqual([]);
  });
  it('сводит часы, жанры (играли + пройдено), платину', () => {
    const r = composeStats({
      ...base,
      period: resolvePeriod('month', 2026, 10),
      firstSnapshotDate: '2026-03-01',
      snapshots: [
        { gameId: 1, date: '2026-09-30', seconds: 10 * H },
        { gameId: 1, date: '2026-10-31', seconds: 14 * H },
        { gameId: 2, date: '2026-09-30', seconds: 5 * H },
        { gameId: 2, date: '2026-10-31', seconds: 5 * H }, // не играли
      ],
      trophies: [{ type: 'platinum', earnedAt: new Date('2026-10-12T10:00:00Z') }],
      finishedEvents: [{ gameId: 3, kind: 'completed', at: new Date('2026-10-12T10:00:00Z') }],
      gameById: new Map([[3, game(3, 'Z')]]),
      genreGames: new Map([
        [1, { psnGenres: ['ACTION'], genresOverride: null }],
        [2, { psnGenres: ['PUZZLE'], genresOverride: null }],
        [3, { psnGenres: ['ACTION', 'ADVENTURE'], genresOverride: null }],
      ]),
    });
    expect(r.header).toEqual({ completed: 1, dropped: 0, hours: 4, platinum: 1 });
    expect(r.hours.periodPartial).toBe(false);
    expect(r.genres.items.map((i) => [i.key, i.value])).toEqual([['ACTION', 1.5], ['ADVENTURE', 0.5]]);
  });
});
