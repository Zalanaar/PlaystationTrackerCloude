import { describe, expect, it } from 'vitest';
import type { GameItem } from '@/server/collection/types';
import { peakMonth, pickPlatinums, splitFinished, topGamesBySeconds } from './calc';
import { composeWrapped, type WrappedInput } from './compose';
import { parseWrappedQuery } from './validation';

const H = 3600;
const game = (id: number, title: string, o: Partial<GameItem> = {}): GameItem => ({
  id, title, coverUrl: null, platform: 'PS5', playSeconds: 0, hours: 0, playCount: 5, lastPlayedAt: null, status: null,
  completedAt: null, droppedAt: null, trophies: null, genres: [{ key: 'ACTION', label: 'Экшен' }], ...o,
});
const games = new Map([1, 2, 3, 4, 5, 6, 7].map((i) => [i, game(i, `G${i}`)]));

const base = (o: Partial<WrappedInput> = {}): WrappedInput => ({
  year: 2026, today: '2026-10-27', years: [{ year: 2026, hasData: true }], onlineId: 'me',
  snapshots: [], estimates: [], firstSnapshotDate: null, trophies: [], platinums: [], finishedEvents: [],
  gameById: games, genreGames: new Map(), ...o,
});
const snaps = (id: number, a: [string, number][]) => a.map(([date, h]) => ({ gameId: id, date, seconds: h * H }));

describe('topGamesBySeconds', () => {
  it('до 5, по убыванию, ничья по названию затем id', () => {
    const m = new Map([[1, 10 * H], [2, 30 * H], [3, 30 * H], [4, 20 * H], [5, 5 * H], [6, 1 * H], [7, 0]]);
    const r = topGamesBySeconds(m, games);
    expect(r.map((x) => x.game.id)).toEqual([2, 3, 4, 1, 5]);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(r[0].hours).toBe(30);
  });
  it('игра без карточки пропускается', () => expect(topGamesBySeconds(new Map([[99, H]]), games)).toEqual([]));
});

describe('peakMonth', () => {
  it('ничья = ранний, нули/null не считаются', () => {
    expect(peakMonth([null, 5, 9, 9, 0])).toEqual({ month: 3, value: 9 });
    expect(peakMonth([null, 0])).toBeNull();
  });
});

describe('splitFinished', () => {
  it('счётчики, списки и самый активный месяц по МСК', () => {
    const r = splitFinished(
      [
        { gameId: 1, kind: 'completed', at: new Date('2026-03-10T10:00:00Z') },
        { gameId: 2, kind: 'dropped', at: new Date('2026-03-20T10:00:00Z') },
        { gameId: 3, kind: 'completed', at: new Date('2026-05-31T21:00:00Z') }, // 1 июня МСК
        { gameId: 4, kind: 'completed', at: new Date('2026-06-02T10:00:00Z') },
        { gameId: 5, kind: 'dropped', at: new Date('2026-06-05T10:00:00Z') },
      ],
      games,
    );
    expect(r.completed.count).toBe(3);
    expect(r.dropped.count).toBe(2);
    expect(r.completed.items[0].game.id).toBe(4);
    expect(r.busiestMonth).toEqual({ month: 6, count: 3 }); // 21:00Z 31 мая = июнь МСК
    expect(peakMonth([2, 2])).toEqual({ month: 1, value: 2 });
  });
});

describe('pickPlatinums', () => {
  const p = (at: string, rate: number | null) => ({ at, name: null, earnedRate: rate, rarity: null, setName: 's', game: null });
  it('первая, последняя, самая редкая; без rate не участвует', () => {
    const r = pickPlatinums([p('2026-05-01T00:00:00Z', 10), p('2026-02-01T00:00:00Z', null), p('2026-09-01T00:00:00Z', 2.5)]);
    expect(r.first?.at).toBe('2026-02-01T00:00:00Z');
    expect(r.last?.at).toBe('2026-09-01T00:00:00Z');
    expect(r.rarest?.earnedRate).toBe(2.5);
  });
  it('одна платина: first = last; пусто = null', () => {
    const r = pickPlatinums([p('2026-05-01T00:00:00Z', null)]);
    expect(r.first).toBe(r.last);
    expect(r.rarest).toBeNull();
    expect(pickPlatinums([])).toEqual({ first: null, last: null, rarest: null });
  });
});

describe('composeWrapped', () => {
  it('год без данных: mode empty, один слайд, дата начала синка', () => {
    const r = composeWrapped(base({ year: 2025, firstSnapshotDate: '2026-03-04' }));
    expect(r.mode).toBe('empty');
    expect(r.slides).toEqual(['empty']);
    expect(r.emptyState).toEqual({ syncStartedOn: '2026-03-04' });
    expect(r.hours).toMatchObject({ hasData: false, total: null, topMonth: null });
    expect(r.hours.byMonth).toHaveLength(12);
    expect(r.longestGame.game).toBeNull();
  });
  it('пустая БД: empty, syncStartedOn null', () => {
    const r = composeWrapped(base());
    expect(r.mode).toBe('empty');
    expect(r.emptyState).toEqual({ syncStartedOn: null });
    expect(r.periodPartial).toBe(true);
  });
  it('охват есть, но часов 0: год пуст', () => {
    const r = composeWrapped(base({ firstSnapshotDate: '2026-01-01', snapshots: snaps(1, [['2026-01-01', 5], ['2026-06-01', 5]]) }));
    expect(r.hours).toMatchObject({ hasData: false, total: 0 });
    expect(r.mode).toBe('empty');
  });
  it('нет часов, но есть трофеи: слайды hours/topGames/longestGame пропущены', () => {
    const r = composeWrapped(base({ year: 2025, trophies: [{ type: 'platinum', earnedAt: new Date('2025-06-01T00:00:00Z') }] }));
    expect(r.mode).toBe('story');
    expect(r.slides).toEqual(['start', 'trophies', 'final']);
    expect(r.trophies.counts).toMatchObject({ platinum: 1, total: 1 });
    expect(r.topGames.hasData).toBe(false);
  });
  it('полный год: все слайды, топ, самая долгая игра, жанры топ-3', () => {
    const r = composeWrapped(
      base({
        firstSnapshotDate: '2025-12-31',
        snapshots: [
          ...snaps(1, [['2025-12-31', 0], ['2026-10-01', 40]]),
          ...snaps(2, [['2025-12-31', 0], ['2026-05-01', 10]]),
        ],
        trophies: [{ type: 'gold', earnedAt: new Date('2026-02-01T00:00:00Z') }],
        finishedEvents: [{ gameId: 2, kind: 'completed', at: new Date('2026-05-02T00:00:00Z') }],
        genreGames: new Map([[1, { psnGenres: ['ACTION'], genresOverride: null }], [2, { psnGenres: ['PUZZLE'], genresOverride: null }]]),
      }),
    );
    expect(r.slides).toEqual(['start', 'hours', 'topGames', 'finished', 'trophies', 'genres', 'longestGame', 'final']);
    expect(r.hours).toMatchObject({ total: 50, days: 2.1, topMonth: { month: 10, hours: 40 } });
    expect(r.periodPartial).toBe(false);
    expect(r.topGames.items.map((x) => x.game.id)).toEqual([1, 2]);
    expect(r.longestGame).toMatchObject({ hasData: true, hours: 40, playCount: 5 });
    expect(r.emptyState).toBeNull();
  });
  it('границы года МСК: трофей 20:59:59Z 31 дек в 2025, 21:00:00Z уже в 2026', () => {
    const t = [
      { type: 'bronze' as const, earnedAt: new Date('2025-12-31T20:59:59.999Z') },
      { type: 'bronze' as const, earnedAt: new Date('2025-12-31T21:00:00.000Z') },
    ];
    expect(composeWrapped(base({ year: 2025, trophies: t })).trophies.counts.total).toBe(1);
    expect(composeWrapped(base({ year: 2026, trophies: t })).trophies.counts.total).toBe(1);
  });
});

describe('parseWrappedQuery', () => {
  const q = (s: string) => parseWrappedQuery(new URLSearchParams(s), 2026);
  it('по умолчанию текущий год, валидный год', () => {
    expect(q('')).toEqual({ ok: true, value: { year: 2026 } });
    expect(q('year=2024')).toEqual({ ok: true, value: { year: 2024 } });
  });
  it('мусор', () => {
    for (const s of ['year=x', 'year=1999', 'year=2101', 'year=-1', 'year=2024.5']) expect(q(s).ok, s).toBe(false);
  });
});
