// QA Фазы 5: сверка чисел /api/stats с независимым прямым SQL по тем же данным + краевые случаи.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { getStats } from './query';

const { games, gameStatus, playtimeSnapshots, trophies, trophySets } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');
const TZ = 'Europe/Moscow';

// детерминированный ГПСЧ
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

describe('getStats против прямого SQL (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function game(n: number, o: Partial<typeof games.$inferInsert> = {}) {
    const [g] = await t.db.insert(games).values({ titleId: `CUSA${n}_00`, name: `G${n}`, category: 'ps4_game', lastSeenAt: NOW, ...o }).returning();
    return g.id;
  }
  const rows = async <T,>(q: ReturnType<typeof sql>) => (await t.pg.execute(q)).rows as T[];

  /** Независимая формула 1.6 в SQL: end = последний <= to, base = последний < from, иначе первый внутри; max(0, end-base). */
  async function sqlHours(from: string, to: string): Promise<number> {
    const r = await rows<{ s: string | null }>(sql`
      select sum(greatest(0, e.sec - coalesce(b.sec, f.sec))) as s
      from (select distinct game_id from playtime_snapshots) g
      join lateral (select play_duration_seconds sec from playtime_snapshots where game_id = g.game_id and snapshot_date <= ${to}::date order by snapshot_date desc limit 1) e on true
      left join lateral (select play_duration_seconds sec from playtime_snapshots where game_id = g.game_id and snapshot_date < ${from}::date order by snapshot_date desc limit 1) b on true
      left join lateral (select play_duration_seconds sec from playtime_snapshots where game_id = g.game_id and snapshot_date >= ${from}::date and snapshot_date <= ${to}::date order by snapshot_date asc limit 1) f on true
    `);
    return Math.round(Number(r[0]?.s ?? 0) / 360) / 10;
  }
  /**
   * Независимая оценка (1.6) в SQL: S0 делится поровну по месяцам МСК [месяц first_played_at .. месяц min(last_played_at, D0)],
   * остаток в последний месяц. Возвращает секунды оценки по (game_id, месяц).
   */
  async function sqlEstimateRows() {
    return rows<{ game_id: number; m: string; sec: string }>(sql`
      with f as (
        select distinct on (p.game_id) p.game_id, p.snapshot_date d0, p.play_duration_seconds s0,
               (g.first_played_at at time zone ${TZ})::date fp, (g.last_played_at at time zone ${TZ})::date lp
        from playtime_snapshots p join games g on g.id = p.game_id
        order by p.game_id, p.snapshot_date
      ), r as (
        select game_id, s0, date_trunc('month', fp)::date m1,
               date_trunc('month', case when lp is null or lp < fp then fp else least(lp, d0) end)::date m2
        from f where fp is not null and fp <= d0 and s0 > 0
      ), x as (
        select r.game_id, r.s0, gs::date m, row_number() over (partition by r.game_id order by gs) i,
               count(*) over (partition by r.game_id) n
        from r, generate_series(r.m1, r.m2, interval '1 month') gs
      )
      select game_id, m::text m, (s0 / n + case when i = n then s0 % n else 0 end)::text sec from x
    `);
  }
  /** Реальные + оценка за [from,to] (целые месяцы), округление как в контракте. */
  async function sqlHoursWithEstimate(from: string, to: string) {
    const real = await rawRealSeconds(from, to);
    const est = (await sqlEstimateRows())
      .filter((r) => r.m.slice(0, 7) >= from.slice(0, 7) && r.m.slice(0, 7) <= to.slice(0, 7))
      .reduce((a, r) => a + Number(r.sec), 0);
    return { hasEst: est > 0, hours: Math.round((real + est) / 360) / 10, est, real };
  }
  async function rawRealSeconds(from: string, to: string): Promise<number> {
    const r = await rows<{ s: string | null }>(sql`
      select sum(greatest(0, e.sec - coalesce(b.sec, f.sec))) as s
      from (select distinct game_id from playtime_snapshots) g
      join lateral (select play_duration_seconds sec from playtime_snapshots where game_id = g.game_id and snapshot_date <= ${to}::date order by snapshot_date desc limit 1) e on true
      left join lateral (select play_duration_seconds sec from playtime_snapshots where game_id = g.game_id and snapshot_date < ${from}::date order by snapshot_date desc limit 1) b on true
      left join lateral (select play_duration_seconds sec from playtime_snapshots where game_id = g.game_id and snapshot_date >= ${from}::date and snapshot_date <= ${to}::date order by snapshot_date asc limit 1) f on true
    `);
    return Number(r[0]?.s ?? 0);
  }
  const sqlTrophies = async (fromUtc: string, toUtc: string) =>
    rows<{ type: string; n: string }>(sql`select type::text, count(*)::text n from trophies where earned and earned_at >= ${fromUtc}::timestamptz and earned_at < ${toUtc}::timestamptz group by type`);
  const sqlFinished = async (fromUtc: string, toUtc: string) => {
    const c = await rows<{ n: string }>(sql`select count(*)::text n from game_status where status='completed' and completed_at >= ${fromUtc}::timestamptz and completed_at < ${toUtc}::timestamptz`);
    const d = await rows<{ n: string }>(sql`select count(*)::text n from game_status where status='dropped' and dropped_at >= ${fromUtc}::timestamptz and dropped_at < ${toUtc}::timestamptz`);
    return { completed: Number(c[0].n), dropped: Number(d[0].n) };
  };

  it('случайный набор: header/hours/trophies/finished совпадают с SQL по всем месяцам 2026, годам 2025..2027', async () => {
    const rand = rng(42);
    const ids: number[] = [];
    for (let i = 1; i <= 25; i++) ids.push(await game(i, { psnGenres: i % 3 === 0 ? ['ACTION', 'ADVENTURE'] : ['PUZZLE'] }));
    // снимки: каждая игра со случайного дня, нерегулярные пропуски, иногда падение значения
    const snaps: (typeof playtimeSnapshots.$inferInsert)[] = [];
    for (const id of ids) {
      let sec = Math.floor(rand() * 5000);
      const start = new Date(Date.UTC(2025, 10, 20 + Math.floor(rand() * 60)));
      for (let d = 0; d < 330; d++) {
        if (rand() < 0.25) continue; // пропуск дня
        const date = new Date(start.getTime() + d * 86400_000);
        if (date.getTime() > Date.UTC(2026, 9, 27)) break;
        sec = rand() < 0.02 ? Math.max(0, sec - 3600) : sec + Math.floor(rand() * 4000);
        snaps.push({ gameId: id, snapshotDate: date.toISOString().slice(0, 10), playDurationSeconds: sec });
      }
    }
    for (let i = 0; i < snaps.length; i += 500) await t.db.insert(playtimeSnapshots).values(snaps.slice(i, i + 500));

    const [s] = await t.db.insert(trophySets).values({ npCommunicationId: 'NPWR9', npServiceName: 'trophy', name: 'orphan' }).returning();
    const types = ['platinum', 'gold', 'silver', 'bronze'] as const;
    const tr: (typeof trophies.$inferInsert)[] = [];
    for (let i = 0; i < 300; i++) {
      const at = new Date(Date.UTC(2025, 0, 1) + Math.floor(rand() * 3 * 365 * 86400_000));
      tr.push({ trophySetId: s.id, trophyId: i, type: types[i % 4], earned: true, earnedAt: at });
    }
    // границы лет и месяцев по МСК
    const edge = ['2025-12-31T20:59:59.999Z', '2025-12-31T21:00:00.000Z', '2026-09-30T21:00:00.000Z', '2026-09-30T20:59:59.999Z', '2026-12-31T21:00:00.000Z'];
    edge.forEach((e, k) => tr.push({ trophySetId: s.id, trophyId: 1000 + k, type: 'platinum', earned: true, earnedAt: new Date(e) }));
    tr.push({ trophySetId: s.id, trophyId: 2000, type: 'gold', earned: false, earnedAt: null });
    await t.db.insert(trophies).values(tr);

    const sts: (typeof gameStatus.$inferInsert)[] = [];
    ids.forEach((id, i) => {
      const at = new Date(Date.UTC(2025, 6, 1) + Math.floor(rand() * 18 * 30 * 86400_000));
      if (i % 4 === 0) sts.push({ gameId: id, status: 'completed', completedAt: at });
      else if (i % 4 === 1) sts.push({ gameId: id, status: 'dropped', droppedAt: at });
      else if (i % 4 === 2) sts.push({ gameId: id, status: 'completed', completedAt: null }); // без даты
      else sts.push({ gameId: id, status: i % 8 === 3 ? 'service' : 'backlog' }); // чужой статус (БД не даёт держать дату при другом статусе)
    });
    await t.db.insert(gameStatus).values(sts);

    const periods: { type: 'year' | 'month'; year: number; month: number | null }[] = [
      { type: 'year', year: 2025, month: null }, { type: 'year', year: 2026, month: null }, { type: 'year', year: 2027, month: null },
      ...Array.from({ length: 12 }, (_, i) => ({ type: 'month' as const, year: 2026, month: i + 1 })),
      { type: 'month', year: 2025, month: 12 },
    ];
    const probe = await getStats(t.db, { type: 'year', year: 2026, month: null }, NOW);
    expect(probe.header.hours ?? 0, 'набор данных не пустой').toBeGreaterThan(50);
    expect(probe.trophies.counts.total).toBeGreaterThan(50);
    expect(probe.header.completed + probe.header.dropped).toBeGreaterThan(3);
    for (const p of periods) {
      const r = await getStats(t.db, p, NOW);
      const label = `${p.type} ${p.year}-${p.month}`;
      const hrs = await sqlHours(r.period.from, r.period.to);
      const covered = r.header.hours !== null;
      if (covered) expect(r.header.hours, `hours ${label}`).toBeCloseTo(hrs, 5);
      else expect(hrs, `hours(null) ${label}`).toBe(0);

      const tc = Object.fromEntries((await sqlTrophies(r.period.fromUtc, r.period.toUtc)).map((x) => [x.type, Number(x.n)]));
      expect(r.trophies.counts, `trophies ${label}`).toMatchObject({ platinum: tc.platinum ?? 0, gold: tc.gold ?? 0, silver: tc.silver ?? 0, bronze: tc.bronze ?? 0 });
      expect(r.header.platinum).toBe(r.trophies.counts.platinum);
      expect(r.trophies.counts.total).toBe(Object.values(tc).reduce((a, b) => a + b, 0));

      const f = await sqlFinished(r.period.fromUtc, r.period.toUtc);
      expect(r.header, `finished ${label}`).toMatchObject(f);
      expect(r.finished.groups.flatMap((g) => g.items).length).toBe(f.completed + f.dropped);

      // помесячная линия трофеев года = SQL с группировкой по МСК
      const yr = await rows<{ m: number; type: string; n: string }>(sql`
        select extract(month from earned_at at time zone ${TZ})::int m, type::text, count(*)::text n from trophies
        where earned and extract(year from earned_at at time zone ${TZ}) = ${p.year} group by 1,2`);
      for (const m of r.trophies.byMonth) {
        for (const ty of types) {
          const exp = Number(yr.find((x) => x.m === m.month && x.type === ty)?.n ?? 0);
          expect(m[ty], `line ${label} m${m.month} ${ty}`).toBe(exp);
        }
      }
      // часы по месяцам = SQL по каждому месяцу
      for (let mi = 1; mi <= 12; mi++) {
        const from = `${p.year}-${String(mi).padStart(2, '0')}-01`;
        const last = new Date(Date.UTC(p.year, mi, 0)).getUTCDate();
        const v = r.hours.byMonth[mi - 1];
        if (v !== null) expect(v, `byMonth ${label} m${mi}`).toBeCloseTo(await sqlHours(from, `${p.year}-${String(mi).padStart(2, '0')}-${last}`), 5);
      }
    }
  });

  it('границы лет по МСК: платина 21:00:00.000Z 31 дек = 1 января, 20:59:59.999Z = 31 декабря', async () => {
    const [s] = await t.db.insert(trophySets).values({ npCommunicationId: 'NPWR1', npServiceName: 'trophy', name: 'x' }).returning();
    await t.db.insert(trophies).values([
      { trophySetId: s.id, trophyId: 0, type: 'platinum', earned: true, earnedAt: new Date('2025-12-31T20:59:59.999Z') },
      { trophySetId: s.id, trophyId: 1, type: 'platinum', earned: true, earnedAt: new Date('2025-12-31T21:00:00.000Z') },
    ]);
    const y25 = await getStats(t.db, { type: 'year', year: 2025, month: null }, NOW);
    const y26 = await getStats(t.db, { type: 'year', year: 2026, month: null }, NOW);
    expect(y25.header.platinum).toBe(1);
    expect(y26.header.platinum).toBe(1);
    expect(y25.trophies.byMonth[11].platinum).toBe(1);
    expect(y26.trophies.byMonth[0].platinum).toBe(1);
    const dec = await getStats(t.db, { type: 'month', year: 2025, month: 12 }, NOW);
    const jan = await getStats(t.db, { type: 'month', year: 2026, month: 1 }, NOW);
    expect(dec.header.platinum + jan.header.platinum).toBe(2);
    expect(jan.header.platinum).toBe(1);
  });

  it('completed_at / dropped_at: полуинтервал [from, to), чужой статус и без даты не считаются, оба события в одном месяце', async () => {
    const a = await game(1), b = await game(2), c = await game(3), d = await game(4);
    await t.db.insert(gameStatus).values([
      { gameId: a, status: 'completed', completedAt: new Date('2026-09-30T21:00:00.000Z') }, // 1 окт 00:00 МСК: октябрь
      { gameId: b, status: 'completed', completedAt: new Date('2026-10-31T21:00:00.000Z') }, // ноябрь
      { gameId: c, status: 'backlog' },                                                        // чужой статус: не считать
      { gameId: d, status: 'dropped', droppedAt: null },                                       // без даты
    ]);
    const oct = await getStats(t.db, { type: 'month', year: 2026, month: 10 }, NOW);
    expect(oct.header).toMatchObject({ completed: 1, dropped: 0 });
    expect(oct.finished.groups.map((g) => g.items.map((i) => i.game.id))).toEqual([[a]]);
    const nov = await getStats(t.db, { type: 'month', year: 2026, month: 11 }, NOW);
    expect(nov.finished.groups[0].items[0].game.id).toBe(b);
    const y = await getStats(t.db, { type: 'year', year: 2026, month: null }, NOW);
    expect(y.header).toMatchObject({ completed: 2, dropped: 0 });
  });

  it('часы: снимки начались посреди месяца (число от первого), прошлое = null, падение значения = 0, игра, появившаяся позже', async () => {
    const a = await game(1), b = await game(2), c = await game(3);
    await t.db.insert(playtimeSnapshots).values([
      { gameId: a, snapshotDate: '2026-03-04', playDurationSeconds: 3600 },
      { gameId: a, snapshotDate: '2026-03-31', playDurationSeconds: 3600 * 3 },
      { gameId: a, snapshotDate: '2026-04-30', playDurationSeconds: 3600 * 4 },
      { gameId: b, snapshotDate: '2026-03-04', playDurationSeconds: 7200 },
      { gameId: b, snapshotDate: '2026-04-30', playDurationSeconds: 3600 }, // PSN уменьшил
      { gameId: c, snapshotDate: '2026-04-15', playDurationSeconds: 100 * 3600 }, // новая игра в апреле: единственный снимок
      { gameId: c, snapshotDate: '2026-04-20', playDurationSeconds: 101 * 3600 },
    ]);
    const y = await getStats(t.db, { type: 'year', year: 2026, month: null }, NOW);
    expect(y.hours.firstSnapshotDate).toBe('2026-03-04');
    expect(y.hours.periodPartial).toBe(true);
    expect(y.hours.byMonth.slice(0, 2)).toEqual([null, null]);
    expect(y.hours.byMonth[2]).toBe(2); // a: 3-1=2, b: 0 (нет падения до конца марта)
    expect(y.hours.byMonth[3]).toBe(2); // a: 1, b: max(0, 1-2)=0, c: 1
    expect(y.hours.byMonth.slice(10)).toEqual([null, null]); // будущее
    expect(y.header.hours).toBe(4); // a: 4-1=3, b: 0, c: 1
    const feb = await getStats(t.db, { type: 'month', year: 2026, month: 2 }, NOW);
    expect(feb.header.hours).toBeNull();
    const mar = await getStats(t.db, { type: 'month', year: 2026, month: 3 }, NOW);
    expect(mar.hours.periodPartial).toBe(true);
    const may = await getStats(t.db, { type: 'month', year: 2026, month: 5 }, NOW);
    expect(may.hours.periodPartial).toBe(false);
    expect(may.header.hours).toBe(0); // охват есть, игры без изменений = 0, не null
    expect(may.genres.hasData).toBe(false);
  });

  it('жанры: сумма значений = числу игр периода, 1/N, override, dropped попадает в жанры без часов, топ-8', async () => {
    const a = await game(1, { psnGenres: ['ACTION', 'ADVENTURE', 'SHOOTER'] });
    const b = await game(2, { psnGenres: ['ACTION'], genresOverride: ['PUZZLE'] });
    const c = await game(3, { psnGenres: [] });
    const d = await game(4, { psnGenres: ['ACTION'] }); // не играл, не завершён: не в жанрах
    await t.db.insert(playtimeSnapshots).values([
      { gameId: a, snapshotDate: '2026-09-30', playDurationSeconds: 0 }, { gameId: a, snapshotDate: '2026-10-10', playDurationSeconds: 3600 },
      { gameId: b, snapshotDate: '2026-09-30', playDurationSeconds: 0 }, { gameId: b, snapshotDate: '2026-10-10', playDurationSeconds: 3600 },
      { gameId: d, snapshotDate: '2026-09-30', playDurationSeconds: 5 }, { gameId: d, snapshotDate: '2026-10-10', playDurationSeconds: 5 },
    ]);
    await t.db.insert(gameStatus).values({ gameId: c, status: 'dropped', droppedAt: new Date('2026-10-05T10:00:00Z') });
    const r = await getStats(t.db, { type: 'month', year: 2026, month: 10 }, NOW);
    const total = r.genres.items.reduce((s, i) => s + i.value, 0);
    expect(total).toBeCloseTo(3, 0);
    const by = Object.fromEntries(r.genres.items.map((i) => [i.key, i.value]));
    expect(by).toMatchObject({ ACTION: 0.3, ADVENTURE: 0.3, SHOOTER: 0.3, PUZZLE: 1, OTHER: 1 });
    // тот же месяц, но игра с ненулевыми часами и статусом completed считается один раз
    expect(r.genres.items[0].value).toBeGreaterThanOrEqual(r.genres.items[1].value);
  });

  it('крайние параметры не падают: 2000/1, 2100/12, будущий год', async () => {
    for (const q of [{ type: 'month', year: 2000, month: 1 }, { type: 'month', year: 2100, month: 12 }, { type: 'year', year: 2100, month: null }] as const) {
      const r = await getStats(t.db, q, NOW);
      expect(r.hours.byMonth).toHaveLength(12);
      expect(r.header.hours).toBeNull();
    }
    const r = await getStats(t.db, { type: 'month', year: 2000, month: 1 }, NOW);
    expect(r.years).toEqual([2026]);
  });

  it('текущий день МСК после полуночи: 00:30 МСК 1 ноября (21:30 UTC 31 окт) уже ноябрь для охвата', async () => {
    const a = await game(1);
    await t.db.insert(playtimeSnapshots).values([
      { gameId: a, snapshotDate: '2026-10-31', playDurationSeconds: 0 }, { gameId: a, snapshotDate: '2026-11-01', playDurationSeconds: 3600 },
    ]);
    const now = new Date('2026-10-31T21:30:00Z');
    const nov = await getStats(t.db, { type: 'month', year: 2026, month: 11 }, now);
    expect(nov.header.hours).toBe(1);
    expect(nov.hours.byMonth[10]).toBe(1);
  });
  it('оценка до первого снимка: header/byMonth/estimatedByMonth/years совпадают с независимым SQL (случайный набор, 2022..2027)', async () => {
    const rand = rng(99);
    const ids: number[] = [];
    for (let i = 1; i <= 30; i++) {
      const fp = i % 6 === 0 ? null : new Date(Date.UTC(2022, 0, 1) + Math.floor(rand() * 4 * 365 * 86400_000));
      // last: иногда null, иногда раньше first, иногда позже D0
      const lp = i % 7 === 0 ? null : i % 5 === 0 && fp ? new Date(fp.getTime() - 40 * 86400_000) : new Date(Date.UTC(2022, 0, 1) + Math.floor(rand() * 5 * 365 * 86400_000));
      ids.push(await game(i, { firstPlayedAt: fp, lastPlayedAt: lp }));
    }
    const snaps: (typeof playtimeSnapshots.$inferInsert)[] = [];
    ids.forEach((id, k) => {
      let sec = 3600 * (1 + Math.floor(rand() * 60)) + Math.floor(rand() * 3600) + (k % 3); // нечётные секунды: остаток округления
      const start = new Date(Date.UTC(2026, 2, 4 + (k % 4 === 0 ? 70 + k : 0))); // часть игр добавлена позже
      for (let d = 0; d < 230; d++) {
        const date = new Date(start.getTime() + d * 86400_000);
        if (date.getTime() > Date.UTC(2026, 9, 27)) break;
        if (rand() < 0.3) continue;
        sec += rand() < 0.4 ? 0 : Math.floor(rand() * 3000);
        snaps.push({ gameId: id, snapshotDate: date.toISOString().slice(0, 10), playDurationSeconds: sec });
      }
    });
    for (let i = 0; i < snaps.length; i += 500) await t.db.insert(playtimeSnapshots).values(snaps.slice(i, i + 500));
    expect((await sqlEstimateRows()).length, 'оценка не пустая').toBeGreaterThan(30);

    const periods: { type: 'year' | 'month'; year: number; month: number | null }[] = [
      ...[2022, 2023, 2024, 2025, 2026, 2027].map((year) => ({ type: 'year' as const, year, month: null })),
      ...Array.from({ length: 12 }, (_, i) => ({ type: 'month' as const, year: 2026, month: i + 1 })),
      { type: 'month', year: 2024, month: 5 },
    ];
    for (const p of periods) {
      const r = await getStats(t.db, p, NOW);
      const label = `${p.type} ${p.year}-${p.month}`;
      const e = await sqlHoursWithEstimate(r.period.from, r.period.to);
      if (r.header.hours === null) {
        expect(e.est, `null => нет оценки ${label}`).toBe(0);
        expect(e.real, `null => нет реальных ${label}`).toBe(0);
      } else {
        expect(r.header.hours, `hours ${label}`).toBeCloseTo(e.hours, 5);
      }
      expect(r.hours.hasEstimate, `hasEstimate ${label}`).toBe(e.hasEst);
      expect(r.hours.estimatedHours, `estimatedHours ${label}`).toBeCloseTo(Math.round(e.est / 360) / 10, 5);
      for (let mi = 1; mi <= 12; mi++) {
        const from = `${p.year}-${String(mi).padStart(2, '0')}-01`;
        const to = `${p.year}-${String(mi).padStart(2, '0')}-${new Date(Date.UTC(p.year, mi, 0)).getUTCDate()}`;
        const em = await sqlHoursWithEstimate(from, to);
        const v = r.hours.byMonth[mi - 1];
        expect(r.hours.estimatedByMonth[mi - 1], `estimatedByMonth ${label} m${mi}`).toBeCloseTo(Math.round(em.est / 360) / 10, 5);
        if (v === null) expect(em.est + em.real, `null month ${label} m${mi}`).toBe(0);
        else expect(v, `byMonth ${label} m${mi}`).toBeCloseTo(em.hours, 5);
      }
    }
    // годы: каждый год с долей оценки присутствует в years
    const estYears = new Set((await sqlEstimateRows()).map((x) => Number(x.m.slice(0, 4))));
    const y = await getStats(t.db, { type: 'year', year: 2026, month: null }, NOW);
    for (const yr of estYears) expect(y.years, `year ${yr}`).toContain(yr);
  });

  it('пример Артёма через БД: янв-фев, 20 ч -> 10/10; месяц первого снимка получает долю оценки + реальные без двойного счёта', async () => {
    const a = await game(1, { firstPlayedAt: new Date('2026-01-10T12:00:00Z'), lastPlayedAt: new Date('2026-03-04T12:00:00Z') });
    await t.db.insert(playtimeSnapshots).values([
      { gameId: a, snapshotDate: '2026-03-04', playDurationSeconds: 20 * 3600 },
      { gameId: a, snapshotDate: '2026-03-20', playDurationSeconds: 23 * 3600 },
    ]);
    const y = await getStats(t.db, { type: 'year', year: 2026, month: null }, NOW);
    // 3 месяца (янв, фев, март): 20 ч / 3 = 6.666.. ч; март = доля + 3 ч реальных
    expect(y.hours.estimatedByMonth.slice(0, 4)).toEqual([6.7, 6.7, 6.7, 0]);
    expect(y.header.hours).toBe(23);
    expect(y.hours.hasEstimate).toBe(true);
    expect(y.hours.estimatedHours).toBe(20);
    expect(y.hours.byMonth[2]).toBe(9.7);
    expect(y.genres.hasData).toBe(true); // игра с оценкой считается сыгранной
    const jan = await getStats(t.db, { type: 'month', year: 2026, month: 1 }, NOW);
    expect(jan.header.hours).toBe(6.7); // раньше было бы null
    expect(jan.hours.periodPartial).toBe(true);
    const y25 = await getStats(t.db, { type: 'year', year: 2025, month: null }, NOW);
    expect(y25.header.hours).toBeNull();
    expect(y25.hours.hasEstimate).toBe(false);
  });
});
