// Этап 2, контракт 15.1: исключение игры из месяца. Чистые функции + PGlite (setMonthExclusion, getStats).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import type { GameItem } from '@/server/collection/types';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { MonthExclusionConflictError, applyExclusions, canExclude, getMonthExclusions, setMonthExclusion } from './exclusions';
import { estimateByMonth, estimateRangeMonths, type EstimateInput } from './hours';
import { resolvePeriod } from './period';
import { groupPlayed } from './played';
import { getStats } from './query';

const H = 3600;
const inp = (o: Partial<EstimateInput> = {}): EstimateInput => ({
  gameId: 1,
  firstSnapshotDate: '2026-10-27',
  firstSeconds: 100 * H,
  firstPlayedAt: new Date('2026-01-10T12:00:00Z'),
  lastPlayedAt: new Date('2026-04-20T12:00:00Z'), // янв..апр = 4 месяца
  ...o,
});
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe('estimateByMonth с исключениями', () => {
  it('без исключений: поровну', () => {
    expect([...estimateByMonth(inp()).values()]).toEqual([25 * H, 25 * H, 25 * H, 25 * H]);
  });
  it('исключённый месяц получает 0 (нет в карте), остальные делят поровну, сумма = S0', () => {
    const m = estimateByMonth(inp({ excludedMonths: new Set(['2026-02']) }));
    expect(m.has('2026-02')).toBe(false);
    expect([...m.keys()]).toEqual(['2026-01', '2026-03', '2026-04']);
    expect(sum(m)).toBe(100 * H);
    expect(m.get('2026-01')).toBe(Math.floor((100 * H) / 3));
  });
  it('остаток округления уходит в последний оставшийся месяц', () => {
    const m = estimateByMonth(inp({ firstSeconds: 10, excludedMonths: new Set(['2026-04']) })); // 10/3
    expect([...m.values()]).toEqual([3, 3, 4]);
  });
  it('исключение вне диапазона ничего не меняет', () => {
    expect(estimateByMonth(inp({ excludedMonths: new Set(['2025-05']) }))).toEqual(estimateByMonth(inp()));
  });
  it('диапазон из одного месяца: исключение убирает оценку целиком', () => {
    const one = inp({ lastPlayedAt: new Date('2026-01-20T12:00:00Z'), excludedMonths: new Set(['2026-01']) });
    expect(estimateRangeMonths(one)).toEqual(['2026-01']);
    expect(estimateByMonth(one).size).toBe(0);
  });
  it('исключены все месяцы длинного диапазона (несогласованные данные): исключения игнорируются, часы не теряются', () => {
    const all = inp({ excludedMonths: new Set(['2026-01', '2026-02', '2026-03', '2026-04']) });
    expect(sum(estimateByMonth(all))).toBe(100 * H);
  });
  it('нет оценки (S0 = 0, нет first_played_at): пусто, исключения не мешают', () => {
    expect(estimateByMonth(inp({ firstSeconds: 0, excludedMonths: new Set(['2026-01']) })).size).toBe(0);
    expect(estimateByMonth(inp({ firstPlayedAt: null, excludedMonths: new Set(['2026-01']) })).size).toBe(0);
  });
  it('applyExclusions не копирует игры без исключений', () => {
    const a = inp();
    const [r] = applyExclusions([a], new Map());
    expect(r).toBe(a);
  });
});

describe('canExclude (границы)', () => {
  const range = ['2026-01', '2026-02'];
  it('последний неисключённый месяц длинного диапазона нельзя', () => {
    expect(canExclude(range, new Set(), '2026-01')).toBe(true);
    expect(canExclude(range, new Set(['2026-01']), '2026-02')).toBe(false);
  });
  it('один месяц, пустой диапазон и месяц вне диапазона: можно', () => {
    expect(canExclude(['2026-01'], new Set(), '2026-01')).toBe(true);
    expect(canExclude([], new Set(), '2026-01')).toBe(true);
    expect(canExclude(range, new Set(['2026-01']), '2027-01')).toBe(true);
  });
});

const game = (id: number): GameItem => ({
  id, title: `G${id}`, coverUrl: null, platform: 'PS5', playSeconds: 0, hours: 0, playCount: 0, lastPlayedAt: null,
  status: null, completedAt: null, droppedAt: null, trophies: null, genres: [], bannerUrl: null, hiddenAt: null,
});

describe('groupPlayed: excluded[]', () => {
  const estimates = [inp({ excludedMonths: new Set(['2026-02']) })];
  const by = new Map([[1, [{ date: '2026-10-27', seconds: 100 * H }]]]);
  const run = (exclusions: Map<number, Set<string>>) =>
    groupPlayed({ by, estimates, period: resolvePeriod('year', 2026, null), finishedEvents: [], gameById: new Map([[1, game(1)]]), exclusions });

  it('исключённый месяц: игры нет в items, есть в excluded; остальные месяцы содержат перераспределённую оценку', () => {
    const g = run(new Map([[1, new Set(['2026-02'])]]));
    const feb = g.find((x) => x.month === '2026-02')!;
    expect(feb.items).toEqual([]);
    expect(feb.excluded).toHaveLength(1);
    expect(feb.excluded![0]).toMatchObject({ hours: 0, hoursReal: 0, hoursEstimated: 0, estimated: false });
    const jan = g.find((x) => x.month === '2026-01')!;
    expect(jan.items[0]).toMatchObject({ hoursEstimated: 33.3, hoursReal: 0, estimated: true });
    expect(jan.excluded).toEqual([]);
  });
  it('исключение месяца, где игры не было, не создаёт записей', () => {
    const g = run(new Map([[1, new Set(['2026-08'])]]));
    expect(g.find((x) => x.month === '2026-08')).toBeUndefined();
  });
  it('реальные часы месяца остаются в excluded.hoursReal', () => {
    const by2 = new Map([[1, [{ date: '2026-05-01', seconds: 10 * H }, { date: '2026-05-20', seconds: 14 * H }]]]);
    const g = groupPlayed({
      by: by2, estimates: [], period: resolvePeriod('month', 2026, 5), finishedEvents: [], gameById: new Map([[1, game(1)]]),
      exclusions: new Map([[1, new Set(['2026-05'])]]),
    });
    expect(g).toHaveLength(1);
    expect(g[0].items).toEqual([]);
    expect(g[0].excluded![0]).toMatchObject({ hours: 4, hoursReal: 4, hoursEstimated: 0 });
  });
});

describe('setMonthExclusion и getStats (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function seedGame(o: { first: string; last: string; seconds: number }) {
    const [g] = await t.db
      .insert(schema.games)
      .values({ titleId: 'CUSA1', name: 'A', category: 'ps5_native_game', lastSeenAt: new Date(), firstPlayedAt: new Date(o.first), lastPlayedAt: new Date(o.last) })
      .returning();
    await t.db.insert(schema.playtimeSnapshots).values({ gameId: g.id, snapshotDate: '2026-10-27', playDurationSeconds: o.seconds, lastPlayedAt: new Date(o.last) });
    return g.id;
  }

  it('перераспределение, идемпотентность, снятие, 409 на последнем месяце, 404', async () => {
    const id = await seedGame({ first: '2026-01-10T12:00:00Z', last: '2026-02-20T12:00:00Z', seconds: 20 * H }); // янв-фев
    const r1 = await setMonthExclusion(t.db, id, '2026-01', true);
    expect(r1).toEqual({ excludedMonths: ['2026-01'], redistributed: true, estimateDropped: false });
    expect(await setMonthExclusion(t.db, id, '2026-01', true)).toEqual(r1); // идемпотентно

    const stats = await getStats(t.db, { type: 'year', year: 2026, month: null }, new Date('2026-10-28T10:00:00Z'));
    expect(stats.hours.byMonth.slice(0, 3)).toEqual([null, 20, null]); // всё в феврале, в январе нет ни оценки, ни охвата
    expect(stats.header.hours).toBe(20);

    await expect(setMonthExclusion(t.db, id, '2026-02', true)).rejects.toBeInstanceOf(MonthExclusionConflictError);
    expect((await getMonthExclusions(t.db)).get(id)).toEqual(new Set(['2026-01']));

    const back = await setMonthExclusion(t.db, id, '2026-01', false);
    expect(back).toEqual({ excludedMonths: [], redistributed: false, estimateDropped: false });
    await expect(setMonthExclusion(t.db, 9999, '2026-01', true)).rejects.toThrow();
  });

  it('один месяц диапазона: оценка выпадает (estimateDropped)', async () => {
    const id = await seedGame({ first: '2026-03-02T12:00:00Z', last: '2026-03-20T12:00:00Z', seconds: 8 * H });
    expect(await setMonthExclusion(t.db, id, '2026-03', true)).toEqual({ excludedMonths: ['2026-03'], redistributed: false, estimateDropped: true });
    const stats = await getStats(t.db, { type: 'year', year: 2026, month: null }, new Date('2026-10-28T10:00:00Z'));
    expect(stats.hours.estimatedHours).toBe(0);
    expect(stats.played.groups.find((g) => g.month === '2026-03')?.excluded?.[0].game.id).toBe(id);
  });

  it('реальные часы не двигаются: byMonth тот же, игра уходит из items месяца в excluded', async () => {
    const id = await seedGame({ first: '2026-10-01T12:00:00Z', last: '2026-10-20T12:00:00Z', seconds: 0 });
    await t.db.insert(schema.playtimeSnapshots).values({ gameId: id, snapshotDate: '2026-10-28', playDurationSeconds: 5 * H });
    const q = { type: 'month' as const, year: 2026, month: 10 };
    const now = new Date('2026-10-28T10:00:00Z');
    const before = await getStats(t.db, q, now);
    await setMonthExclusion(t.db, id, '2026-10', true);
    const after = await getStats(t.db, q, now);
    expect(after.hours.byMonth).toEqual(before.hours.byMonth);
    expect(after.header.hours).toBe(before.header.hours);
    expect(before.played.groups[0].items).toHaveLength(1);
    expect(after.played.groups[0].items).toHaveLength(0);
    expect(after.played.groups[0].excluded).toHaveLength(1);
  });
});

import { parseMonthExclusionBody } from '@/server/collection/validation';
describe('parseMonthExclusionBody', () => {
  it('валидные и мусорные тела', () => {
    expect(parseMonthExclusionBody({ month: '2026-03', excluded: true })).toEqual({ ok: true, value: { month: '2026-03', excluded: true } });
    for (const bad of [null, {}, { month: '2026-13', excluded: true }, { month: '2026-3', excluded: true }, { month: '1999-01', excluded: true }, { month: '2026-03' }, { month: '2026-03', excluded: 'yes' }, { month: 5, excluded: true }]) {
      expect(parseMonthExclusionBody(bad).ok).toBe(false);
    }
  });
});
