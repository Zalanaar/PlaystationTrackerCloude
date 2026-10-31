// QA правки 2 (оценка часов до первого снимка, контракт 1.6): независимые проверки.
// Эталон оценки не использует код продукта: месяцы собираются обходом по дням через Intl (Europe/Moscow).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { getWrapped } from '@/server/wrapped/query';
import { calcHours, estimateByMonth, groupSnapshots, type EstimateInput } from './hours';
import { getStats } from './query';

const { games, gameStatus, playtimeSnapshots } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');
const DAY = 86400_000;

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const mskFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' });
const msk = (d: Date) => mskFmt.format(d); // YYYY-MM-DD

/** Эталон: месяцы между датами обходом по дням, доли целочисленным делением. */
function refEstimate(i: EstimateInput): Record<string, number> {
  if (!i.firstPlayedAt || i.firstSeconds <= 0) return {};
  const first = msk(i.firstPlayedAt);
  if (first > i.firstSnapshotDate) return {};
  let end = i.lastPlayedAt ? msk(i.lastPlayedAt) : first;
  if (end < first) end = first;
  if (end > i.firstSnapshotDate) end = i.firstSnapshotDate;
  const months: string[] = [];
  for (let t = Date.parse(first + 'T12:00:00Z'); msk(new Date(t)) <= end || new Date(t).toISOString().slice(0, 10) <= end; t += DAY) {
    const ds = new Date(t).toISOString().slice(0, 10);
    if (ds > end) break;
    const mk = ds.slice(0, 7);
    if (months[months.length - 1] !== mk) months.push(mk);
  }
  const n = months.length;
  const share = Math.floor(i.firstSeconds / n);
  const out: Record<string, number> = {};
  months.forEach((m, k) => (out[m] = share + (k === n - 1 ? i.firstSeconds - share * n : 0)));
  return out;
}

describe('estimateByMonth против эталона (обход по дням, Intl)', () => {
  it('2000 случайных входов, включая метки у границ месяца МСК', () => {
    const rand = rng(7);
    const edge = [0, 1, 3 * 3600_000 - 1, 3 * 3600_000, 21 * 3600_000 - 1, 21 * 3600_000, 24 * 3600_000 - 1];
    for (let n = 0; n < 2000; n++) {
      const d0 = new Date(Date.UTC(2023, 0, 1) + Math.floor(rand() * 3.8 * 365) * DAY);
      const monthStart = Date.UTC(2020 + Math.floor(rand() * 6), Math.floor(rand() * 12), 1);
      const pick = () => (rand() < 0.5 ? new Date(monthStart - 3 * 3600_000 + edge[Math.floor(rand() * edge.length)] + Math.floor(rand() * 40) * DAY) : new Date(d0.getTime() + Math.floor((rand() - 0.8) * 5 * 365) * DAY));
      const inp: EstimateInput = {
        gameId: n,
        firstSnapshotDate: d0.toISOString().slice(0, 10),
        firstSeconds: rand() < 0.1 ? 0 : Math.floor(rand() * 400000) + (rand() < 0.2 ? 1 : 0),
        firstPlayedAt: rand() < 0.1 ? null : pick(),
        lastPlayedAt: rand() < 0.15 ? null : pick(),
      };
      const got = Object.fromEntries(estimateByMonth(inp));
      expect(got, JSON.stringify(inp)).toEqual(refEstimate(inp));
      const total = Object.values(got).reduce((a, b) => a + b, 0);
      if (Object.keys(got).length) expect(total).toBe(inp.firstSeconds);
    }
  });
});

describe('calcHours: сохранение секунд, ни одна игра не считается дважды', () => {
  it('сумма по всем годам = S_last - (S0, если оценки нет); сумма byMonth ~ total; без дублей между месяцами', () => {
    const rand = rng(123);
    const snaps: { gameId: number; date: string; seconds: number }[] = [];
    const estimates: EstimateInput[] = [];
    const expectedTotal = new Map<number, number>();
    for (let id = 1; id <= 120; id++) {
      const d0 = new Date(Date.UTC(2024, 0, 1) + Math.floor(rand() * 2.6 * 365) * DAY);
      let sec = Math.floor(rand() * 200000) + (id % 9 === 0 ? 0 : 1);
      const s0 = sec;
      const fp = id % 8 === 0 ? null : new Date(d0.getTime() + Math.floor((rand() - 0.97) * 6 * 365) * DAY + Math.floor(rand() * DAY));
      const lp = id % 7 === 0 ? null : new Date((fp ?? d0).getTime() + Math.floor((rand() - 0.2) * 3 * 365) * DAY);
      let last = s0;
      for (let t = d0.getTime(); t <= Date.UTC(2026, 9, 27); t += DAY) {
        if (t !== d0.getTime() && rand() < 0.5) continue;
        sec += rand() < 0.6 ? 0 : Math.floor(rand() * 9000);
        snaps.push({ gameId: id, date: new Date(t).toISOString().slice(0, 10), seconds: t === d0.getTime() ? s0 : sec });
        last = t === d0.getTime() ? s0 : sec;
      }
      const est: EstimateInput = { gameId: id, firstSnapshotDate: d0.toISOString().slice(0, 10), firstSeconds: s0, firstPlayedAt: fp, lastPlayedAt: lp };
      estimates.push(est);
      const hasEst = Object.keys(refEstimate(est)).length > 0;
      expectedTotal.set(id, last - (hasEst ? 0 : s0));
    }
    const by = groupSnapshots(snaps);
    const first = snaps.reduce((a, s) => (s.date < a ? s.date : a), '9999');
    const sumPerGame = new Map<number, number>();
    for (let year = 2018; year <= 2027; year++) {
      const h = calcHours({ by, estimates, period: { from: `${year}-01-01`, to: `${year}-12-31` }, year, firstSnapshotDate: first, today: '2026-10-27' });
      for (const [id, v] of h.seconds) sumPerGame.set(id, (sumPerGame.get(id) ?? 0) + v);
      if (h.totalHours !== null) {
        const sum = h.byMonth.reduce<number>((a, v) => a + (v ?? 0), 0);
        expect(Math.abs(sum - h.totalHours), `byMonth vs total ${year}`).toBeLessThanOrEqual(0.7);
        const estSum = h.estimatedByMonth.reduce((a, v) => a + v, 0);
        expect(Math.abs(estSum - h.estimatedHours), `estimated ${year}`).toBeLessThanOrEqual(0.7);
      }
      h.byMonth.forEach((v, i) => {
        if (v !== null) expect(h.estimatedByMonth[i], `est<=full ${year}-${i}`).toBeLessThanOrEqual(v + 1e-9);
      });
    }
    for (const [id, want] of expectedTotal) expect(sumPerGame.get(id) ?? 0, `game ${id}`).toBe(want);
  });

  it('месячные периоды по сумме дают годовой итог (секунды), без дублей на границах', () => {
    const est: EstimateInput = { gameId: 1, firstSnapshotDate: '2026-03-04', firstSeconds: 100001, firstPlayedAt: new Date('2025-11-30T21:00:00Z'), lastPlayedAt: new Date('2026-02-15T00:00:00Z') };
    const snaps = [
      { gameId: 1, date: '2026-03-04', seconds: 100001 },
      { gameId: 1, date: '2026-03-31', seconds: 110000 },
      { gameId: 1, date: '2026-04-01', seconds: 120000 },
    ];
    const by = groupSnapshots(snaps);
    let monthly = 0;
    for (const y of [2025, 2026]) {
      for (let m = 1; m <= 12; m++) {
        const to = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const h = calcHours({ by, estimates: [est], period: { from: `${y}-${String(m).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${to}` }, year: y, firstSnapshotDate: '2026-03-04', today: '2026-10-27' });
        monthly += h.seconds.get(1) ?? 0;
      }
    }
    expect(monthly).toBe(120000); // всё время игры, один раз
  });
});

describe('Статистика и Итоги: одинаковые часы, согласование years/mode (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function game(n: number, o: Partial<typeof games.$inferInsert> = {}) {
    const [g] = await t.db.insert(games).values({ userId: 1, titleId: `CUSA${n}_00`, name: `G${n}`, category: 'ps4_game', lastSeenAt: NOW, ...o }).returning();
    return g.id;
  }

  it('случайный набор: Wrapped.hours == Stats.header/hours за каждый год; сумма byMonth ~ header; игра service учтена, но не в finished', async () => {
    const rand = rng(2024);
    const ids: number[] = [];
    for (let i = 1; i <= 40; i++) {
      const fp = i % 7 === 0 ? null : new Date(Date.UTC(2021, 0, 1) + Math.floor(rand() * 5.5 * 365) * DAY);
      const lp = i % 5 === 0 ? null : new Date(Date.UTC(2021, 0, 1) + Math.floor(rand() * 5.8 * 365) * DAY);
      ids.push(await game(i, { firstPlayedAt: fp, lastPlayedAt: lp, psnGenres: ['ACTION'] }));
    }
    const rows: (typeof playtimeSnapshots.$inferInsert)[] = [];
    ids.forEach((id, k) => {
      let sec = Math.floor(rand() * 90000);
      const start = Date.UTC(2026, 2, 4) + (k % 5 === 0 ? 60 * DAY : 0);
      for (let t0 = start; t0 <= Date.UTC(2026, 9, 27); t0 += DAY) {
        if (rand() < 0.4) continue;
        sec += rand() < 0.5 ? 0 : Math.floor(rand() * 4000);
        rows.push({ userId: 1, gameId: id, snapshotDate: new Date(t0).toISOString().slice(0, 10), playDurationSeconds: sec });
      }
    });
    for (let i = 0; i < rows.length; i += 500) await t.db.insert(playtimeSnapshots).values(rows.slice(i, i + 500));
    // 3 игры-сервиса: статус не должен убирать часы
    for (const id of ids.slice(0, 3)) await t.db.insert(gameStatus).values({ userId: 1, gameId: id, status: 'service' });

    for (const year of [2021, 2022, 2023, 2024, 2025, 2026, 2027]) {
      const s = await getStats(t.db, TEST_USER, { type: 'year', year, month: null }, NOW);
      const w = await getWrapped(t.db, TEST_USER, year, null, NOW);
      expect(w.hours.total, `total ${year}`).toBe(s.header.hours);
      expect(w.hours.byMonth, `byMonth ${year}`).toEqual(s.hours.byMonth);
      expect(w.hours.estimatedByMonth).toEqual(s.hours.estimatedByMonth);
      expect(w.hours.estimatedHours).toBe(s.hours.estimatedHours);
      expect(w.hours.hasEstimate).toBe(s.hours.hasEstimate);
      expect(w.firstSnapshotDate).toBe(s.hours.firstSnapshotDate);
      if (s.header.hours !== null) {
        const sum = s.hours.byMonth.reduce<number>((a, v) => a + (v ?? 0), 0);
        expect(Math.abs(sum - s.header.hours), `sum byMonth ${year}`).toBeLessThanOrEqual(0.7);
      }
      // топ-игры из Итогов не превышают годовой итог и содержат только положительные часы
      const topSum = w.topGames.items.reduce((a, x) => a + x.seconds, 0) / 3600;
      if (w.hours.total !== null) expect(topSum).toBeLessThanOrEqual(w.hours.total + 0.1);
      expect(w.topGames.items.every((x) => x.seconds > 0)).toBe(true);
      expect(w.mode === 'story', `mode ${year}`).toBe(w.hours.hasData || w.trophies.counts.total > 0 || w.finished.completed.count + w.finished.dropped.count > 0);
      // years Итогов согласованы с mode
      const yh = (await getWrapped(t.db, TEST_USER, 2026, null, NOW)).years.find((y) => y.year === year);
      if (yh) expect(w.mode === 'story', `years.hasData vs mode ${year}`).toBe(yh.hasData);
      // years Статистики содержат все годы Итогов с данными
      for (const y of (await getWrapped(t.db, TEST_USER, 2026, null, NOW)).years) if (y.hasData) expect(s.years).toContain(y.year);
    }
    // service-игры не попадают в пройдено/брошено
    const s26 = await getStats(t.db, TEST_USER, { type: 'year', year: 2026, month: null }, NOW);
    expect(s26.header.completed + s26.header.dropped).toBe(0);
  });

  it('жанры периода: игра только с оценкой в периоде учитывается, без оценки и без часов нет', async () => {
    const a = await game(1, { psnGenres: ['PUZZLE'], firstPlayedAt: new Date('2025-02-10T12:00:00Z'), lastPlayedAt: new Date('2025-04-10T12:00:00Z') });
    const b = await game(2, { psnGenres: ['RACING'], firstPlayedAt: null });
    await t.db.insert(playtimeSnapshots).values([
      { userId: 1, gameId: a, snapshotDate: '2026-03-04', playDurationSeconds: 36000 },
      { userId: 1, gameId: b, snapshotDate: '2026-03-04', playDurationSeconds: 36000 },
    ]);
    const s25 = await getStats(t.db, TEST_USER, { type: 'year', year: 2025, month: null }, NOW);
    expect(s25.genres.items.map((g) => g.key)).toEqual(['PUZZLE']);
    const apr = await getStats(t.db, TEST_USER, { type: 'month', year: 2025, month: 4 }, NOW);
    expect(apr.genres.items.map((g) => g.key)).toEqual(['PUZZLE']);
    const may = await getStats(t.db, TEST_USER, { type: 'month', year: 2025, month: 5 }, NOW);
    expect(may.genres.hasData).toBe(false);
    const s26 = await getStats(t.db, TEST_USER, { type: 'year', year: 2026, month: null }, NOW);
    expect(s26.genres.hasData).toBe(false); // реальных дельт нет, оценка вся в 2025
  });

  it('игра добавлена после первого синка: оценка по её D0, часы до D0 не дублируются', async () => {
    const a = await game(1, { firstPlayedAt: new Date('2026-04-10T12:00:00Z'), lastPlayedAt: new Date('2026-08-01T00:00:00Z') });
    const old = await game(2, { firstPlayedAt: null });
    await t.db.insert(playtimeSnapshots).values([
      { userId: 1, gameId: old, snapshotDate: '2026-03-04', playDurationSeconds: 3600 },
      { userId: 1, gameId: a, snapshotDate: '2026-08-10', playDurationSeconds: 5 * 3600 },
      { userId: 1, gameId: a, snapshotDate: '2026-08-20', playDurationSeconds: 7 * 3600 },
    ]);
    const s = await getStats(t.db, TEST_USER, { type: 'year', year: 2026, month: null }, NOW);
    // апр..авг = 5 месяцев по 1 ч, август + 2 ч реальных
    expect(s.hours.estimatedByMonth.slice(3, 8)).toEqual([1, 1, 1, 1, 1]);
    expect(s.hours.byMonth[7]).toBe(3);
    expect(s.header.hours).toBe(7);
  });

  // BUG-E1 (исправлен): год с долей оценки < 0.05 ч не считается годом с данными.
  it('КРАЙ: крошечный S0 (меньше числа месяцев): years[].hasData и mode Итогов', async () => {
    // 5 секунд игры за 75 месяцев: доли 0, остаток 5 с в последний месяц
    const a = await game(1, { firstPlayedAt: new Date('2020-01-10T12:00:00Z'), lastPlayedAt: new Date('2026-03-04T00:00:00Z') });
    await t.db.insert(playtimeSnapshots).values({ userId: 1, gameId: a, snapshotDate: '2026-03-04', playDurationSeconds: 5 });
    const base = await getWrapped(t.db, TEST_USER, 2026, null, NOW);
    for (const y of base.years) {
      const w = await getWrapped(t.db, TEST_USER, y.year, null, NOW);
      expect(w.mode === 'story', `year ${y.year}`).toBe(y.hasData);
    }
  });

  it('КРАЙ: игра 1 минута за 6 лет (доля года < 0.05 ч): years.hasData vs mode', async () => {
    const a = await game(1, { firstPlayedAt: new Date('2020-01-10T12:00:00Z'), lastPlayedAt: new Date('2026-03-04T00:00:00Z') });
    await t.db.insert(playtimeSnapshots).values({ userId: 1, gameId: a, snapshotDate: '2026-03-04', playDurationSeconds: 60 });
    const base = await getWrapped(t.db, TEST_USER, 2026, null, NOW);
    for (const y of base.years) {
      const w = await getWrapped(t.db, TEST_USER, y.year, null, NOW);
      expect(w.mode === 'story', `year ${y.year}`).toBe(y.hasData);
    }
  });

  it('граница округления: год с оценкой 179 с не с данными, 180 с (0.1 ч) с данными', async () => {
    // два месяца 2025-12 и 2026-01: S0 = 359 -> доли 179 и 180
    const a = await game(1, { firstPlayedAt: new Date('2025-12-10T12:00:00Z'), lastPlayedAt: new Date('2026-01-04T00:00:00Z') });
    await t.db.insert(playtimeSnapshots).values({ userId: 1, gameId: a, snapshotDate: '2026-01-05', playDurationSeconds: 359 });
    const y = (await getWrapped(t.db, TEST_USER, 2026, null, NOW)).years;
    expect(y.find((v) => v.year === 2025)?.hasData ?? false).toBe(false);
    expect(y.find((v) => v.year === 2026)?.hasData).toBe(true);
    expect((await getWrapped(t.db, TEST_USER, 2025, null, NOW)).mode).toBe('empty');
    expect((await getWrapped(t.db, TEST_USER, 2026, null, NOW)).mode).toBe('story');
    expect((await getStats(t.db, TEST_USER, { type: 'year', year: 2025, month: null }, NOW)).years).not.toContain(2025);
  });

  it('sql-сверка: сумма оценки по всем месяцам игры равна S0 (нет потерь остатка)', async () => {
    const a = await game(1, { firstPlayedAt: new Date('2025-01-31T20:59:59Z'), lastPlayedAt: new Date('2026-03-04T00:00:00Z') });
    await t.db.insert(playtimeSnapshots).values({ userId: 1, gameId: a, snapshotDate: '2026-03-04', playDurationSeconds: 100003 });
    let tot = 0;
    for (const y of [2025, 2026]) {
      const s = await getStats(t.db, TEST_USER, { type: 'year', year: y, month: null }, NOW);
      tot += s.hours.estimatedHours;
    }
    expect(Math.abs(tot - 100003 / 3600)).toBeLessThan(0.15);
    const r = await t.pg.execute(sql`select count(*)::int n from playtime_snapshots`);
    expect((r.rows[0] as { n: number }).n).toBe(1);
  });
});
