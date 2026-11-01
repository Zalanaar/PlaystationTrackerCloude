// Фаза 25: «за всё время» (контракт 26.1): чистые расчёты и getStats(period=all) на PGlite.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@/db';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { allPeriod, calcHoursByYear, finishedByYear, trophiesByYear, yearRange } from './all-time';
import type { EstimateInput } from './hours';
import { getStats } from './query';
import { parseStatsQuery } from './validation';

const { games, gameStatus, playtimeSnapshots, trophySets, trophies, gameTrophySets } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');
const NO_DUP = new Map<number, number>();

describe('yearRange / allPeriod (чистые)', () => {
  it('годы по возрастанию без пропусков', () => {
    expect(yearRange([2026, 2024])).toEqual([2024, 2025, 2026]);
    expect(yearRange([])).toEqual([]);
  });
  it('границы: МСК-полночь первого дня и следующего за последним', () => {
    expect(allPeriod(2026, '2025-01-10', '2026-10-20')).toMatchObject({ type: 'all', from: '2025-01-10', to: '2026-10-20', fromUtc: '2025-01-09T21:00:00.000Z', toUtc: '2026-10-20T21:00:00.000Z' });
    expect(allPeriod(2026, null, null)).toMatchObject({ from: null, to: null, fromUtc: null, toUtc: null });
    // конец года: следующий день переполняет месяц
    expect(allPeriod(2026, '2026-12-31', '2026-12-31').toUtc).toBe('2026-12-31T21:00:00.000Z');
  });
});

describe('calcHoursByYear: инвариант sum(byYear) + unattributed == total', () => {
  const pts = [
    { gameId: 1, date: '2025-03-01', seconds: 3600 },
    { gameId: 1, date: '2025-12-31', seconds: 7200 },
    { gameId: 1, date: '2026-10-20', seconds: 18000 },
  ];
  it('снимки + оценка, остаток в unattributed', () => {
    const est: EstimateInput[] = [{ gameId: 1, firstSnapshotDate: '2025-03-01', firstSeconds: 3600, firstPlayedAt: new Date('2025-01-10T10:00:00Z'), lastPlayedAt: null }];
    const r = calcHoursByYear({ points: pts, estimates: est, dup: NO_DUP, totalSeconds: 18000 + 7200, years: [2026, 2025] });
    expect(r.byYear).toEqual([
      { year: 2025, hours: 2.0, estimatedHours: 1.0, measuredHours: 1.0 },
      { year: 2026, hours: 3.0, estimatedHours: 0, measuredHours: 3.0 },
    ]);
    expect(r.total).toBe(7.0);
    expect(r.unattributed).toBe(2.0);
    expect(r.estimatedHours).toBe(1.0);
  });
  it('нет игр: total = null, годы нулевые, unattributed = 0', () => {
    const r = calcHoursByYear({ points: [], estimates: [], dup: NO_DUP, totalSeconds: null, years: [2026] });
    expect(r).toEqual({ total: null, byYear: [{ year: 2026, hours: 0, estimatedHours: 0, measuredHours: 0 }], unattributed: 0, estimatedHours: 0 });
  });
  it('отрицательный остаток допустим (PSN уменьшил время), инвариант сохраняется', () => {
    const r = calcHoursByYear({ points: pts, estimates: [], dup: NO_DUP, totalSeconds: 3600, years: [2025, 2026] });
    expect(r.unattributed).toBeLessThan(0);
    expect(Math.round((r.byYear.reduce((a, y) => a + y.hours, 0) + r.unattributed) * 10)).toBe(Math.round((r.total ?? 0) * 10));
  });
  it('случайные данные: инвариант в десятых и measured + estimated = hours', () => {
    let s = 7;
    const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let run = 0; run < 50; run++) {
      const points: { gameId: number; date: string; seconds: number }[] = [];
      const estimates: EstimateInput[] = [];
      for (let g = 1; g <= 6; g++) {
        let sec = Math.floor(rnd() * 20000);
        const y0 = 2022 + Math.floor(rnd() * 3);
        points.push({ gameId: g, date: `${y0}-0${1 + Math.floor(rnd() * 8)}-15`, seconds: sec });
        for (let y = y0; y <= 2026; y++) {
          sec += Math.floor(rnd() * 30000) - 2000;
          points.push({ gameId: g, date: `${y}-12-1${g}`, seconds: Math.max(0, sec) });
        }
        if (rnd() < 0.5) estimates.push({ gameId: g, firstSnapshotDate: points[points.length - 1 - (2026 - y0)].date, firstSeconds: points[points.length - 1 - (2026 - y0)].seconds, firstPlayedAt: new Date(`${y0 - 1}-05-05T10:00:00Z`), lastPlayedAt: null });
      }
      const total = Math.floor(rnd() * 200000);
      const r = calcHoursByYear({ points, estimates, dup: NO_DUP, totalSeconds: total, years: [2022, 2026] });
      const sumT = r.byYear.reduce((a, y) => a + Math.round(y.hours * 10), 0);
      expect(sumT + Math.round(r.unattributed * 10)).toBe(Math.round((r.total ?? 0) * 10));
      for (const y of r.byYear) expect(Math.round(y.measuredHours * 10) + Math.round(y.estimatedHours * 10)).toBe(Math.round(y.hours * 10));
    }
  });
  it('дубль: ряд версии сливается в главную и не задваивается', () => {
    const dup = new Map([[2, 1]]);
    const points = [
      { gameId: 1, date: '2026-01-10', seconds: 3600 },
      { gameId: 1, date: '2026-10-20', seconds: 7200 },
      { gameId: 2, date: '2026-01-10', seconds: 1800 },
      { gameId: 2, date: '2026-10-20', seconds: 3600 },
    ];
    const r = calcHoursByYear({ points, estimates: [], dup, totalSeconds: 7200 + 3600, years: [2026] });
    // (7200-3600) + (3600-1800) = 5400 с = 1.5 ч; разница с суммой PSN 3.0 ч (до первых снимков) уходит в unattributed
    expect(r.byYear[0].hours).toBe(1.5);
    expect(r.unattributed).toBe(1.5);
  });
});

describe('trophiesByYear / finishedByYear (чистые)', () => {
  it('суммы по годам = итог, годы без пропусков', () => {
    const r = trophiesByYear(
      [
        { year: 2024, type: 'platinum', n: 2 },
        { year: 2026, type: 'bronze', n: 5 },
      ],
      [2026, 2024],
    );
    expect(r.byYear.map((y) => y.year)).toEqual([2024, 2025, 2026]);
    expect(r.counts).toEqual({ platinum: 2, gold: 0, silver: 0, bronze: 5, total: 7 });
    expect(r.byYear.reduce((a, y) => a + y.total, 0)).toBe(r.counts.total);
  });
  it('пройдено/брошено', () => {
    const r = finishedByYear(
      [
        { year: 2025, kind: 'completed', n: 3 },
        { year: 2026, kind: 'dropped', n: 1 },
      ],
      [2026],
    );
    expect(r.completed).toBe(3);
    expect(r.dropped).toBe(1);
    expect(r.byYear).toEqual([
      { year: 2025, completed: 3, dropped: 0 },
      { year: 2026, completed: 0, dropped: 1 },
    ]);
  });
});

describe('parseStatsQuery: period=all', () => {
  const q = (s: string) => parseStatsQuery(new URLSearchParams(s), 2026);
  it('year и month игнорируются, даже мусорные', () => {
    expect(q('period=all')).toEqual({ ok: true, value: { type: 'all', year: 2026, month: null } });
    expect(q('period=all&year=abc&month=99')).toEqual({ ok: true, value: { type: 'all', year: 2026, month: null } });
  });
  it('мусор по-прежнему 400', () => {
    for (const b of ['period=ALL', 'period=all2', 'period=', 'period=all&withService=x']) expect(q(b).ok, b).toBe(false);
  });
});

describe('getStats(period=all) на PGlite', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.execute(sql.raw(`insert into allowed_users (email, role, status) values ('b@example.com', 'member', 'active')`));
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  const all = (u = TEST_USER) => getStats(t.db, u, { type: 'all', year: 2026, month: null }, NOW);

  async function seed(u: typeof TEST_USER, name: string) {
    const base = { userId: u, lastSeenAt: NOW, psnGenres: ['ACTION'], conceptId: `C_${name}` };
    const [g1] = await t.db.insert(games).values({ ...base, titleId: 'T1', name: `${name}1`, category: 'ps5_native_game', playDurationSeconds: 18000, firstPlayedAt: new Date('2025-01-10T10:00:00Z'), lastPlayedAt: new Date('2026-10-19T10:00:00Z') }).returning({ id: games.id });
    const [g2] = await t.db.insert(games).values({ userId: u, lastSeenAt: NOW, titleId: 'T2', name: `${name}2`, category: 'ps5_native_game', psnGenres: ['RACING'], playDurationSeconds: 7200 }).returning({ id: games.id });
    const [g3] = await t.db.insert(games).values({ ...base, titleId: 'T3', name: `${name}1`, category: 'ps4_game', playDurationSeconds: 1800, duplicateOfGameId: g1.id }).returning({ id: games.id });
    await t.db.insert(playtimeSnapshots).values([
      { userId: u, gameId: g1.id, snapshotDate: '2025-03-01', playDurationSeconds: 3600 },
      { userId: u, gameId: g1.id, snapshotDate: '2025-12-31', playDurationSeconds: 7200 },
      { userId: u, gameId: g1.id, snapshotDate: '2026-02-01', playDurationSeconds: 10800 },
      { userId: u, gameId: g1.id, snapshotDate: '2026-10-20', playDurationSeconds: 18000 },
      { userId: u, gameId: g3.id, snapshotDate: '2026-03-01', playDurationSeconds: 720 },
      { userId: u, gameId: g3.id, snapshotDate: '2026-10-20', playDurationSeconds: 1800 },
    ]);
    await t.db.insert(gameStatus).values([
      { userId: u, gameId: g1.id, status: 'completed', completedAt: new Date('2025-05-05T10:00:00Z') },
      { userId: u, gameId: g2.id, status: 'dropped', droppedAt: new Date('2026-02-02T10:00:00Z') },
    ]);
    const [set] = await t.db.insert(trophySets).values({ userId: u, npCommunicationId: 'NPWR_A', npServiceName: 'trophy', name: `${name} set`, definedBronze: 1 }).returning({ id: trophySets.id });
    await t.db.insert(gameTrophySets).values([
      { userId: u, gameId: g1.id, trophySetId: set.id, source: 'title_id' },
      { userId: u, gameId: g3.id, trophySetId: set.id, source: 'concept' },
    ]);
    await t.db.insert(trophies).values([
      { userId: u, trophySetId: set.id, trophyId: 0, type: 'platinum', name: 'P', earned: true, earnedAt: new Date('2025-06-01T10:00:00Z'), earnedRate: '2.00' },
      { userId: u, trophySetId: set.id, trophyId: 1, type: 'gold', name: 'G', earned: true, earnedAt: new Date('2025-12-31T20:59:59Z'), earnedRate: '9.00' }, // 23:59:59 МСК 31 декабря: ещё 2025
      { userId: u, trophySetId: set.id, trophyId: 2, type: 'bronze', name: 'B', earned: true, earnedAt: new Date('2025-12-31T21:00:00Z'), earnedRate: '50.00' }, // 00:00 МСК 1 января 2026
      { userId: u, trophySetId: set.id, trophyId: 3, type: 'bronze', name: 'N', earned: true, earnedAt: null },
      { userId: u, trophySetId: set.id, trophyId: 4, type: 'silver', name: 'S', earned: false },
    ]);
    return { g1: g1.id, g2: g2.id, g3: g3.id };
  }

  it('часы: PSN-сумма с дублем один раз, годы, инвариант, оценка отдельно', async () => {
    await seed(TEST_USER, 'A');
    const r = await all();
    expect(r.period).toMatchObject({ type: 'all', month: null, from: '2025-01-10', to: '2026-10-20', fromUtc: '2025-01-09T21:00:00.000Z', toUtc: '2026-10-20T21:00:00.000Z' });
    // 18000 + 1800 (дубль) + 7200 = 27000 с = 7.5 ч, дубль не задваивается
    expect(r.header.hours).toBe(7.5);
    expect(r.hours.byYear).toEqual([
      { year: 2025, hours: 2.0, estimatedHours: 1.0, measuredHours: 1.0 },
      { year: 2026, hours: 3.3, estimatedHours: 0, measuredHours: 3.3 },
    ]);
    expect(r.hours.unattributed).toBe(2.2); // игра без снимков 2.0 + доснимочные 0.2 дубля
    const sum = r.hours.byYear!.reduce((a, y) => a + Math.round(y.hours * 10), 0) + Math.round(r.hours.unattributed! * 10);
    expect(sum).toBe(Math.round(r.header.hours! * 10));
    expect(r.hours.estimatedHours).toBe(1.0);
    expect(r.hours.hasEstimate).toBe(true);
    expect(r.hours.periodPartial).toBe(true);
    expect(r.hours.byMonth).toEqual(new Array(12).fill(null));
  });

  it('трофеи по earned_at (граница года по МСК), пройдено/брошено, жанры, топ, паттерн', async () => {
    const ids = await seed(TEST_USER, 'A');
    const r = await all();
    expect(r.trophies.counts).toEqual({ platinum: 1, gold: 1, silver: 0, bronze: 1, total: 3 });
    expect(r.trophies.byYear).toEqual([
      { year: 2025, platinum: 1, gold: 1, silver: 0, bronze: 0, total: 2 },
      { year: 2026, platinum: 0, gold: 0, silver: 0, bronze: 1, total: 1 },
    ]);
    expect(r.header.platinum).toBe(1);
    expect(r.header).toMatchObject({ completed: 1, dropped: 1 });
    expect(r.finished.byYear).toEqual([
      { year: 2025, completed: 1, dropped: 0 },
      { year: 2026, completed: 0, dropped: 1 },
    ]);
    expect(r.finished.groups).toEqual([]);
    expect(r.years).toEqual([2026, 2025]);
    // топ: дубль отдельной строкой не идёт, часы главной 19800 с = 5.5
    expect(r.top.byHours.map((x) => [x.game.id, x.hours, x.estimated])).toEqual([
      [ids.g1, 5.5, false],
      [ids.g2, 2, false],
    ]);
    expect(r.top.byTrophies.map((x) => x.game.id)).toEqual([ids.g1]);
    // жанры: обе видимые игры с часами; дубль не добавляет вес
    expect(r.genres.items.map((x) => [x.key, x.value])).toEqual([['ACTION', 1], ['RACING', 1]]);
    expect(r.rareTrophies.period).toEqual(r.rareTrophies.allTime);
    expect(r.rareTrophies.allTime.length).toBe(3);
    // паттерн: сумма = число трофеев, мало данных
    expect(r.playPattern?.total).toBe(3);
    expect(r.playPattern?.hasData).toBe(false);
    expect(r.played).toEqual({ games: {}, groups: [] });
  });

  it('жанры: игра без часов, но пройденная когда-либо, входит; без часов и статуса нет', async () => {
    const base = { userId: TEST_USER, lastSeenAt: NOW, category: 'ps5_native_game' as const };
    const [a] = await t.db.insert(games).values({ ...base, titleId: 'X1', name: 'X1', psnGenres: ['ACTION'], playDurationSeconds: 0 }).returning({ id: games.id });
    await t.db.insert(games).values({ ...base, titleId: 'X2', name: 'X2', psnGenres: ['RACING'], playDurationSeconds: 0 });
    await t.db.insert(gameStatus).values({ userId: TEST_USER, gameId: a.id, status: 'completed' }); // без даты
    const r = await all();
    expect(r.genres.items.map((x) => x.key)).toEqual(['ACTION']);
    expect(r.header.completed).toBe(0); // без даты в «пройдено» не считается
    expect(r.header.hours).toBe(0);
  });

  it('пустой пользователь: 200-форма, null-границы, нули', async () => {
    const r = await all();
    expect(r.period).toMatchObject({ type: 'all', from: null, to: null, fromUtc: null, toUtc: null });
    expect(r.header).toEqual({ completed: 0, dropped: 0, hours: null, platinum: 0 });
    expect(r.hours.unattributed).toBe(0);
    expect(r.genres).toEqual({ hasData: false, items: [], games: {} });
    expect(r.playPattern).toMatchObject({ total: 0, peakHour: null, peakWeekday: null, hasData: false });
  });

  it('скрытая игра и её дубль не считаются в часах', async () => {
    const ids = await seed(TEST_USER, 'A');
    await t.db.update(games).set({ hiddenAt: new Date() }).where(sql`id = ${ids.g2}`);
    expect((await all()).header.hours).toBe(5.5);
  });

  it('year/month не получили новых полей (обратная совместимость)', async () => {
    await seed(TEST_USER, 'A');
    const y = await getStats(t.db, TEST_USER, { type: 'year', year: 2026, month: null }, NOW);
    expect(y.hours.byYear).toBeUndefined();
    expect(y.hours.unattributed).toBeUndefined();
    expect(y.trophies.byYear).toBeUndefined();
    expect(y.finished.byYear).toBeUndefined();
    expect(y.period.type).toBe('year');
    expect(y.playPattern?.total).toBe(1); // 2026: только бронза в 00:00 МСК 1 января (золото 23:59:59 МСК 31.12 это 2025)
  });

  it('изоляция по user_id: данные двух пользователей не смешиваются', async () => {
    await seed(TEST_USER, 'MARK_A');
    const b = await seed(TEST_USER_2, 'MARK_B');
    // у B дополнительно игра на 36000 с, у A её нет
    await t.db.update(games).set({ playDurationSeconds: 36000 }).where(sql`id = ${b.g2}`);
    const ra = await all(TEST_USER);
    const rb = await all(TEST_USER_2);
    expect(JSON.stringify(ra)).not.toContain('MARK_B');
    expect(JSON.stringify(rb)).not.toContain('MARK_A');
    expect(ra.header.hours).toBe(7.5);
    expect(rb.header.hours).toBe(7.5 + 8); // 36000 - 7200 = 28800 с = 8 ч
    expect(ra.trophies.counts.total).toBe(3);
    expect(rb.trophies.counts.total).toBe(3);
    expect(ra.playPattern?.total).toBe(3);
  });
});
