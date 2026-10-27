import { describe, expect, it } from 'vitest';
import type { GameItem } from '@/server/collection/types';
import { byLastPlayed, defaultExpandedYears, finishedAt, gridCols, groupChronicle, previewSlots } from './chronicle';

const game = (id: number, o: Partial<GameItem> = {}): GameItem => ({
  id, title: `G${id}`, coverUrl: null, platform: 'PS5', playSeconds: 3600, hours: 1, playCount: 1, lastPlayedAt: null,
  status: 'completed', completedAt: null, droppedAt: null, trophies: null, genres: [], ...o,
});
const done = (id: number, iso: string, o: Partial<GameItem> = {}) => game(id, { status: 'completed', completedAt: iso, ...o });
const drop = (id: number, iso: string, o: Partial<GameItem> = {}) => game(id, { status: 'dropped', droppedAt: iso, ...o });

describe('группировка хроники', () => {
  it('годы по убыванию, месяцы по убыванию, внутри месяца новые первыми', () => {
    const c = groupChronicle([
      done(1, '2025-03-10T12:00:00Z'), done(2, '2026-10-12T10:00:00Z'), done(3, '2026-10-20T10:00:00Z'),
      drop(4, '2026-09-03T10:00:00Z'), done(5, '2024-06-01T12:00:00Z'),
    ]);
    expect(c.years.map((y) => y.year)).toEqual([2026, 2025, 2024]);
    expect(c.years[0].months.map((m) => m.month)).toEqual([10, 9]);
    expect(c.years[0].months[0].games.map((g) => g.id)).toEqual([3, 2]);
    expect(c.years[0]).toMatchObject({ completed: 2, dropped: 1, total: 3 });
    expect(c.years[0].months[1]).toMatchObject({ completed: 0, dropped: 1 });
  });
  it('граница года и месяца по Москве', () => {
    // 21:30 UTC 31 декабря = 00:30 МСК 1 января
    const c = groupChronicle([drop(1, '2025-12-31T21:30:00Z'), done(2, '2025-12-31T20:59:00Z'), done(3, '2026-03-31T21:00:00Z')]);
    expect(c.years.map((y) => y.year)).toEqual([2026, 2025]);
    expect(c.years[0].months.map((m) => [m.month, m.games.map((g) => g.id)])).toEqual([[4, [3]], [1, [1]]]);
    expect(c.years[1].months[0]).toMatchObject({ month: 12 });
  });
  it('«Без даты»: статус есть, даты нет или она битая; игры других статусов не попадают', () => {
    const c = groupChronicle([
      game(1, { status: 'completed', completedAt: null }), drop(2, 'мусор'), game(3, { status: 'backlog' }), done(4, '2026-01-05T10:00:00Z'),
      game(5, { status: 'completed', completedAt: null, playSeconds: 7200 }),
    ]);
    expect(c.undated.map((g) => g.id).sort()).toEqual([1, 2, 5]);
    expect(c.undatedCompleted).toBe(2);
    expect(c.undatedDropped).toBe(1);
    expect(c.undatedSeconds).toBe(3600 * 2 + 7200);
    expect(c.years).toHaveLength(1);
  });
  it('часы группы = сумма полных часов игр', () => {
    const c = groupChronicle([done(1, '2026-01-05T10:00:00Z', { playSeconds: 3600 }), drop(2, '2026-02-05T10:00:00Z', { playSeconds: 5400 })]);
    expect(c.years[0].seconds).toBe(9000);
  });
  it('пусто', () => {
    expect(groupChronicle([])).toMatchObject({ years: [], undated: [] });
  });
  it('finishedAt по статусу', () => {
    expect(finishedAt(done(1, '2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00Z');
    expect(finishedAt(game(1, { status: 'playing', completedAt: '2026-01-01T00:00:00Z' }))).toBeNull();
  });
});

describe('раскрытие годов, превью, колонки', () => {
  const now = Date.parse('2026-10-27T09:00:00Z');
  it('раскрыт текущий год, иначе самый свежий', () => {
    expect([...defaultExpandedYears([2026, 2025], now)]).toEqual([2026]);
    expect([...defaultExpandedYears([2025, 2024], now)]).toEqual([2025]);
    expect(defaultExpandedYears([], now).size).toBe(0);
  });
  it('превью: cols-1 и плитка, либо все', () => {
    expect(previewSlots(8, 6)).toEqual({ shown: 5, rest: 3 });
    expect(previewSlots(6, 6)).toEqual({ shown: 6, rest: 0 });
    expect(previewSlots(177, 10)).toEqual({ shown: 9, rest: 168 });
    expect(previewSlots(0, 6)).toEqual({ shown: 0, rest: 0 });
  });
  it('колонки по ширине', () => {
    expect(gridCols(1440, 'comfort')).toBe(6);
    expect(gridCols(1440, 'dense')).toBe(10);
    expect(gridCols(1100, 'comfort')).toBe(5);
    expect(gridCols(800, 'dense')).toBe(6);
    expect(gridCols(440, 'comfort')).toBe(2);
    expect(gridCols(390, 'dense')).toBe(3);
  });
  it('порядок по последнему запуску', () => {
    const l = [game(1, { lastPlayedAt: null }), game(2, { lastPlayedAt: '2026-01-01T00:00:00Z' }), game(3, { lastPlayedAt: '2026-05-01T00:00:00Z' })];
    expect(l.sort(byLastPlayed).map((g) => g.id)).toEqual([3, 2, 1]);
  });
});
