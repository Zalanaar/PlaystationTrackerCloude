// Фаза 26: «Когда ты играешь» (контракт 26.3): МСК = UTC+3, час и день недели по дате МСК.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { buildPlayPattern, mskHourWeekday, PLAY_PATTERN_LABEL, PLAY_PATTERN_MIN_TOTAL, playPatternFromDates } from './play-pattern';
import { getStats } from './query';

const { trophySets, trophies } = schema;
const at = (s: string) => new Date(s);

describe('mskHourWeekday', () => {
  it('граница полуночи МСК: 20:59:59Z это 23:59:59, 21:00:00Z уже 00:00 следующего дня', () => {
    // 2026-10-31 (суббота) 20:59:59Z -> суббота 23:59 МСК
    expect(mskHourWeekday(at('2026-10-31T20:59:59Z'))).toEqual({ hour: 23, weekday: 5 });
    // 21:00:00Z -> воскресенье 00:00 МСК
    expect(mskHourWeekday(at('2026-10-31T21:00:00Z'))).toEqual({ hour: 0, weekday: 6 });
  });
  it('воскресенье -> понедельник', () => {
    expect(mskHourWeekday(at('2026-11-01T20:59:59Z'))).toEqual({ hour: 23, weekday: 6 }); // вс 23:59 МСК
    expect(mskHourWeekday(at('2026-11-01T21:00:00Z'))).toEqual({ hour: 0, weekday: 0 }); // пн 00:00 МСК
  });
  it('день недели по МСК, а не UTC: 21:30Z субботы это воскресенье 00:30', () => {
    expect(mskHourWeekday(at('2026-10-31T21:30:00Z'))).toEqual({ hour: 0, weekday: 6 });
    expect(mskHourWeekday(at('2026-10-31T10:00:00Z'))).toEqual({ hour: 13, weekday: 5 });
  });
  it('даты до 1970 и високосный день', () => {
    expect(mskHourWeekday(at('1969-12-31T20:59:59Z'))).toEqual({ hour: 23, weekday: 2 }); // 31.12.1969 среда
    expect(mskHourWeekday(at('2024-02-29T12:00:00Z'))).toEqual({ hour: 15, weekday: 3 }); // четверг
  });
});

describe('buildPlayPattern', () => {
  it('пустой период', () => {
    const p = buildPlayPattern([]);
    expect(p.byHour).toEqual(new Array(24).fill(0));
    expect(p.byWeekday).toEqual(new Array(7).fill(0));
    expect(p).toMatchObject({ total: 0, peakHour: null, peakWeekday: null, hasData: false, label: PLAY_PATTERN_LABEL });
  });
  it('пик, ничья = меньший индекс, порог hasData', () => {
    const cells = [
      { hour: 22, weekday: 5, n: 10 },
      { hour: 3, weekday: 1, n: 10 },
      { hour: 22, weekday: 6, n: 0 },
    ];
    const p = buildPlayPattern(cells);
    expect(p.total).toBe(20);
    expect(p.peakHour).toBe(3);
    expect(p.peakWeekday).toBe(1);
    expect(p.hasData).toBe(true);
    expect(buildPlayPattern([{ hour: 1, weekday: 1, n: PLAY_PATTERN_MIN_TOTAL - 1 }]).hasData).toBe(false);
  });
  it('мусорные ячейки игнорируются', () => {
    expect(buildPlayPattern([{ hour: 24, weekday: 0, n: 5 }, { hour: 0, weekday: 7, n: 5 }]).total).toBe(0);
  });
  it('playPatternFromDates: sum(byHour) == sum(byWeekday) == total', () => {
    const dates = Array.from({ length: 50 }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 5_000_000));
    const p = playPatternFromDates(dates);
    expect(p.byHour.reduce((a, b) => a + b, 0)).toBe(50);
    expect(p.byWeekday.reduce((a, b) => a + b, 0)).toBe(50);
    expect(p.total).toBe(50);
  });
});

describe('playPattern в getStats: SQL совпадает с чистой функцией', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  it('год, месяц и всё время; границы МСК; чужие и недатированные трофеи не входят', async () => {
    const [set] = await t.db.insert(trophySets).values({ userId: 1, npCommunicationId: 'NPWR_P', npServiceName: 'trophy', name: 'P', definedBronze: 1 }).returning({ id: trophySets.id });
    let s = 99;
    const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const dates: Date[] = [];
    for (let i = 0; i < 120; i++) dates.push(new Date(Date.UTC(2025, 6, 1) + Math.floor(rnd() * 500 * 24 * 3600 * 1000)));
    // нарочно на границах
    dates.push(at('2026-10-31T20:59:59Z'), at('2026-10-31T21:00:00Z'), at('2026-11-01T21:00:00Z'));
    await t.db.insert(trophies).values(dates.map((d, i) => ({ userId: 1, trophySetId: set.id, trophyId: i, type: 'bronze' as const, name: `T${i}`, earned: true, earnedAt: d })));
    await t.db.insert(trophies).values([
      { userId: 1, trophySetId: set.id, trophyId: 900, type: 'bronze', name: 'no date', earned: true, earnedAt: null },
      { userId: 1, trophySetId: set.id, trophyId: 901, type: 'bronze', name: 'not earned', earned: false, earnedAt: null },
    ]);
    const NOW = new Date('2026-12-01T10:00:00Z');
    const all = await getStats(t.db, TEST_USER, { type: 'all', year: 2026, month: null }, NOW);
    expect(all.playPattern).toEqual(playPatternFromDates(dates));
    expect(all.playPattern?.total).toBe(all.trophies.counts.total);

    const y = await getStats(t.db, TEST_USER, { type: 'year', year: 2026, month: null }, NOW);
    const inYear = dates.filter((d) => d >= at('2025-12-31T21:00:00Z') && d < at('2026-12-31T21:00:00Z'));
    expect(y.playPattern).toEqual(playPatternFromDates(inYear));
    expect(y.playPattern?.total).toBe(y.trophies.counts.total);

    const m = await getStats(t.db, TEST_USER, { type: 'month', year: 2026, month: 10 }, NOW);
    const inMonth = dates.filter((d) => d >= at('2026-09-30T21:00:00Z') && d < at('2026-10-31T21:00:00Z'));
    expect(m.playPattern).toEqual(playPatternFromDates(inMonth));
    expect(m.playPattern?.total).toBe(m.trophies.counts.total);
    // 20:59:59Z 31.10 в октябре, 21:00:00Z уже в ноябре
    expect(inMonth.some((d) => d.getTime() === at('2026-10-31T20:59:59Z').getTime())).toBe(true);
    expect(inMonth.some((d) => d.getTime() === at('2026-10-31T21:00:00Z').getTime())).toBe(false);
  });
});
