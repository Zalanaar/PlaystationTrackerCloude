// QA Фазы 6: сверка /api/wrapped с независимым прямым SQL (PGlite), ничьи, границы года МСК, years[].hasData vs mode.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { getWrapped } from './query';

const { games, gameStatus, gameTrophySets, playtimeSnapshots, trophies, trophySets } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');
const TZ = 'Europe/Moscow';

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

describe('getWrapped против прямого SQL (PGlite)', () => {
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
  const link = (gameId: number, trophySetId: number) =>
    t.db.insert(gameTrophySets).values({ gameId, trophySetId, source: 'manual' });

  /** Независимая формула часов 1.6 по играм: секунды за [from,to], только > 0, порядок как в контракте. */
  const sqlTop = (from: string, to: string) =>
    rows<{ id: number; sec: number }>(sql`
      select g.id, greatest(0, e.sec - coalesce(b.sec, f.sec)) sec
      from games g
      join lateral (select play_duration_seconds sec from playtime_snapshots where game_id = g.id and snapshot_date <= ${to}::date order by snapshot_date desc limit 1) e on true
      left join lateral (select play_duration_seconds sec from playtime_snapshots where game_id = g.id and snapshot_date < ${from}::date order by snapshot_date desc limit 1) b on true
      left join lateral (select play_duration_seconds sec from playtime_snapshots where game_id = g.id and snapshot_date >= ${from}::date and snapshot_date <= ${to}::date order by snapshot_date asc limit 1) f on true
      where greatest(0, e.sec - coalesce(b.sec, f.sec)) > 0
      order by sec desc, lower(g.name), g.id
    `);

  it('случайный набор: топ-5, самая долгая, busiest, платины, жанры топ-3 совпадают с SQL (2025..2027)', async () => {
    const rand = rng(7);
    const ids: number[] = [];
    const pool = [['ACTION'], ['PUZZLE'], ['ACTION', 'ADVENTURE'], ['SIMULATOR'], ['UNIQUE', 'ARCADE'], ['RACING'], ['HORROR']];
    for (let i = 1; i <= 30; i++) {
      ids.push(await game(i, { name: i % 5 === 0 ? `Same` : i % 7 === 0 ? `same` : `Game ${i}`, psnGenres: pool[i % pool.length], genresOverride: i === 9 ? ['PARTY'] : null }));
    }
    const snaps: (typeof playtimeSnapshots.$inferInsert)[] = [];
    for (const id of ids) {
      let sec = Math.floor(rand() * 3) * 3600;
      const start = new Date(Date.UTC(2025, 5, 1 + Math.floor(rand() * 200)));
      for (let d = 0; d < 480; d++) {
        const date = new Date(start.getTime() + d * 86400_000);
        if (date.getTime() > Date.UTC(2026, 9, 27)) break;
        if (rand() < 0.3) continue;
        // кратно часу, чтобы возникали ничьи
        sec = rand() < 0.01 ? Math.max(0, sec - 3600) : sec + (rand() < 0.5 ? 0 : Math.floor(rand() * 3) * 3600);
        snaps.push({ gameId: id, snapshotDate: date.toISOString().slice(0, 10), playDurationSeconds: sec });
      }
    }
    for (let i = 0; i < snaps.length; i += 500) await t.db.insert(playtimeSnapshots).values(snaps.slice(i, i + 500));

    const sets: number[] = [];
    for (let k = 0; k < 8; k++) {
      const [s] = await t.db.insert(trophySets).values({ npCommunicationId: `NPWR${k}`, npServiceName: 'trophy', name: `Set ${k}` }).returning();
      sets.push(s.id);
      if (k < 6) await link(ids[k], s.id);
      if (k === 0) await link(ids[20], s.id); // два игры на сет: берётся минимальный id
    }
    const tr: (typeof trophies.$inferInsert)[] = [];
    let n = 0;
    for (let i = 0; i < 40; i++) {
      tr.push({
        trophySetId: sets[i % sets.length], trophyId: n++, type: 'platinum', earned: true,
        earnedAt: new Date(Date.UTC(2025, 0, 1) + Math.floor(rand() * 3 * 365 * 86400_000)),
        earnedRate: i % 5 === 0 ? null : (Math.floor(rand() * 30) / 10 + 0.5).toFixed(2),
        name: `P${i}`, rarity: i % 4,
      });
    }
    tr.push({ trophySetId: sets[0], trophyId: n++, type: 'gold', earned: true, earnedAt: new Date('2026-05-05T00:00:00Z') });
    tr.push({ trophySetId: sets[0], trophyId: n++, type: 'platinum', earned: false, earnedAt: null });
    await t.db.insert(trophies).values(tr);
    const sts: (typeof gameStatus.$inferInsert)[] = [];
    ids.forEach((id, i) => {
      const at = new Date(Date.UTC(2025, 3, 1) + Math.floor(rand() * 24 * 30 * 86400_000));
      if (i % 3 === 0) sts.push({ gameId: id, status: 'completed', completedAt: at });
      else if (i % 3 === 1) sts.push({ gameId: id, status: 'dropped', droppedAt: at });
    });
    await t.db.insert(gameStatus).values(sts);

    for (const year of [2025, 2026, 2027]) {
      const w = await getWrapped(t.db, year, null, NOW);
      const from = `${year}-01-01`, to = `${year}-12-31`;
      const fromUtc = w.period.fromUtc, toUtc = w.period.toUtc;
      const lbl = `year ${year}`;

      // топ-5 и самая долгая
      const top = (await sqlTop(from, to)).slice(0, 5);
      expect(w.topGames.items.map((x) => [x.game.id, x.seconds]), `top ${lbl}`).toEqual(top.map((x) => [x.id, Number(x.sec)]));
      expect(w.longestGame.game?.id ?? null, `longest ${lbl}`).toBe(top[0]?.id ?? null);

      // пройдено/брошено и самый активный месяц (МСК)
      const fin = await rows<{ kind: string; m: number; id: number; at: string }>(sql`
        select 'completed' kind, extract(month from completed_at at time zone ${TZ})::int m, game_id id, completed_at::text at from game_status where status='completed' and completed_at >= ${fromUtc}::timestamptz and completed_at < ${toUtc}::timestamptz
        union all
        select 'dropped', extract(month from dropped_at at time zone ${TZ})::int, game_id, dropped_at::text from game_status where status='dropped' and dropped_at >= ${fromUtc}::timestamptz and dropped_at < ${toUtc}::timestamptz`);
      expect(w.finished.completed.count, `completed ${lbl}`).toBe(fin.filter((f) => f.kind === 'completed').length);
      expect(w.finished.dropped.count, `dropped ${lbl}`).toBe(fin.filter((f) => f.kind === 'dropped').length);
      const perM = new Map<number, number>();
      for (const f of fin) perM.set(f.m, (perM.get(f.m) ?? 0) + 1);
      let best: { month: number; count: number } | null = null;
      for (let m = 1; m <= 12; m++) if ((perM.get(m) ?? 0) > (best?.count ?? 0)) best = { month: m, count: perM.get(m) as number };
      expect(w.finished.busiestMonth, `busiest ${lbl}`).toEqual(best);

      // платины: первая, последняя, самая редкая (ничья: более ранняя)
      const pl = await rows<{ at: string; name: string | null; rate: string | null; set: string; gid: number | null }>(sql`
        select t.earned_at::text at, t.name, t.earned_rate::text rate, s.name set, (select min(game_id) from game_trophy_sets x where x.trophy_set_id = s.id) gid
        from trophies t join trophy_sets s on s.id = t.trophy_set_id
        where t.type='platinum' and t.earned and t.earned_at >= ${fromUtc}::timestamptz and t.earned_at < ${toUtc}::timestamptz order by t.earned_at`);
      expect(w.trophies.counts.platinum, `plat count ${lbl}`).toBe(pl.length);
      if (pl.length === 0) {
        expect(w.trophies.platinum).toEqual({ first: null, last: null, rarest: null });
      } else {
        const rated = pl.filter((p) => p.rate !== null);
        const rarest = rated.length ? rated.reduce((a, b) => (Number(b.rate) < Number(a.rate) ? b : a)) : null;
        const ts = (iso: string) => new Date(iso).getTime();
        expect(ts(w.trophies.platinum.first?.at as string), `first ${lbl}`).toBe(ts(pl[0].at));
        expect(ts(w.trophies.platinum.last?.at as string), `last ${lbl}`).toBe(ts(pl[pl.length - 1].at));
        expect(w.trophies.platinum.first?.game?.id ?? null).toBe(pl[0].gid);
        if (rarest) {
          expect(w.trophies.platinum.rarest?.earnedRate, `rarest ${lbl}`).toBe(Number(rarest.rate));
          expect(ts(w.trophies.platinum.rarest?.at as string)).toBe(ts(rarest.at));
        } else expect(w.trophies.platinum.rarest).toBeNull();
      }

      // жанры топ-3: игры с часами > 0 или завершённые/брошенные в году, вес 1/N по нормализованным жанрам
      const norm = (g: string) => (g === 'SIMULATOR' ? 'SIMULATION' : g === 'UNIQUE' ? 'OTHER' : g);
      const gids = new Set<number>([...top.length ? (await sqlTop(from, to)).map((x) => x.id) : [], ...fin.map((f) => f.id)]);
      const gr = await rows<{ id: number; psn: string[] | null; ov: string[] | null }>(sql`select id, psn_genres psn, genres_override ov from games`);
      const sums = new Map<string, number>();
      for (const g of gr) {
        if (!gids.has(g.id)) continue;
        const keys = [...new Set((g.ov ?? g.psn ?? []).map(norm))];
        const ks = keys.length ? keys : ['OTHER'];
        for (const k of ks) sums.set(k, (sums.get(k) ?? 0) + 1 / ks.length);
      }
      const exp = [...sums.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3);
      expect(w.genres.items.map((i) => [i.key, i.value]), `genres ${lbl}`).toEqual(exp.map(([k, v]) => [k, Math.round(v * 10) / 10]));
      expect(w.genres.items.length).toBeLessThanOrEqual(3);

      // согласованность: слайды и mode
      expect(w.slides.length === 1 ? w.slides[0] === 'empty' : w.slides[0] === 'start' && w.slides.at(-1) === 'final').toBe(true);
      expect(w.mode === 'empty').toBe(w.slides.length === 1);
    }
  });

  it('years[].hasData совпадает с реальным mode ответа за год (случайные данные)', async () => {
    const rand = rng(11);
    const [s] = await t.db.insert(trophySets).values({ npCommunicationId: 'NPWR1', npServiceName: 'trophy', name: 'S' }).returning();
    const ids: number[] = [];
    for (let i = 1; i <= 6; i++) ids.push(await game(i));
    // 2022 пусто, 2023 только трофей, 2024 только статус, 2025 только часы, 2026 всё
    await t.db.insert(trophies).values({ trophySetId: s.id, trophyId: 0, type: 'bronze', earned: true, earnedAt: new Date('2023-05-01T00:00:00Z') });
    await t.db.insert(gameStatus).values({ gameId: ids[0], status: 'dropped', droppedAt: new Date('2024-02-01T00:00:00Z') });
    await t.db.insert(playtimeSnapshots).values([
      { gameId: ids[1], snapshotDate: '2025-02-01', playDurationSeconds: 3600 },
      { gameId: ids[1], snapshotDate: '2025-03-01', playDurationSeconds: 7200 },
      { gameId: ids[2], snapshotDate: '2026-01-10', playDurationSeconds: 3600 },
      { gameId: ids[2], snapshotDate: '2026-02-10', playDurationSeconds: 3600 + Math.floor(rand() * 5 + 1) * 3600 },
    ]);
    const base = await getWrapped(t.db, 2026, null, NOW);
    expect(base.years.map((y) => y.year)).toEqual([2026, 2025, 2024, 2023]);
    for (const y of base.years) {
      const w = await getWrapped(t.db, y.year, null, NOW);
      expect(w.mode === 'story', `year ${y.year}`).toBe(y.hasData);
    }
    expect((await getWrapped(t.db, 2022, null, NOW)).mode).toBe('empty');
  });

  it('ничьи: топ (lower(title), id), самая долгая = №1, платина-ничья по редкости = более ранняя', async () => {
    const b = await game(1, { name: 'beta' });
    const a = await game(2, { name: 'Alpha' });
    const a2 = await game(3, { name: 'alpha' }); // равен Alpha по lower(), решает id
    await t.db.insert(playtimeSnapshots).values(
      [b, a, a2].flatMap((id) => [
        { gameId: id, snapshotDate: '2025-12-31', playDurationSeconds: 0 },
        { gameId: id, snapshotDate: '2026-05-01', playDurationSeconds: 7200 },
      ]),
    );
    const w = await getWrapped(t.db, 2026, null, NOW);
    expect(w.topGames.items.map((x) => x.game.id)).toEqual([a, a2, b]);
    expect(w.longestGame.game?.id).toBe(a);

    const [s1] = await t.db.insert(trophySets).values({ npCommunicationId: 'N1', npServiceName: 'trophy', name: 'one' }).returning();
    const [s2] = await t.db.insert(trophySets).values({ npCommunicationId: 'N2', npServiceName: 'trophy', name: 'two' }).returning();
    await t.db.insert(trophies).values([
      { trophySetId: s2.id, trophyId: 0, type: 'platinum', earned: true, earnedAt: new Date('2026-08-01T00:00:00Z'), earnedRate: '2.00' },
      { trophySetId: s1.id, trophyId: 0, type: 'platinum', earned: true, earnedAt: new Date('2026-02-01T00:00:00Z'), earnedRate: '2.00' },
    ]);
    const w2 = await getWrapped(t.db, 2026, null, NOW);
    expect(w2.trophies.platinum.rarest?.setName).toBe('one');
    expect(w2.trophies.platinum.first?.setName).toBe('one');
    expect(w2.trophies.platinum.last?.setName).toBe('two');
  });

  it('больше 5 игр на границе топа с равными часами: карточки всех кандидатов загружены, в топе ровно 5', async () => {
    const ids: number[] = [];
    for (let i = 1; i <= 8; i++) ids.push(await game(i, { name: `T${i}` }));
    await t.db.insert(playtimeSnapshots).values(
      ids.flatMap((id) => [
        { gameId: id, snapshotDate: '2025-12-31', playDurationSeconds: 0 },
        { gameId: id, snapshotDate: '2026-06-01', playDurationSeconds: 3600 },
      ]),
    );
    const w = await getWrapped(t.db, 2026, null, NOW);
    expect(w.topGames.items.map((x) => x.game.id)).toEqual(ids.slice(0, 5));
    expect(w.topGames.items.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it('нет часов, но есть трофеи: слайды 2, 3, 7 пропущены; а часы без охвата прошлого года не выдумываются', async () => {
    const a = await game(1);
    await t.db.insert(playtimeSnapshots).values([
      { gameId: a, snapshotDate: '2026-03-04', playDurationSeconds: 3600 },
      { gameId: a, snapshotDate: '2026-04-04', playDurationSeconds: 7200 },
    ]);
    const [s] = await t.db.insert(trophySets).values({ npCommunicationId: 'N1', npServiceName: 'trophy', name: 's' }).returning();
    await t.db.insert(trophies).values({ trophySetId: s.id, trophyId: 0, type: 'platinum', earned: true, earnedAt: new Date('2025-06-01T00:00:00Z') });
    const w = await getWrapped(t.db, 2025, null, NOW);
    expect(w.slides).toEqual(['start', 'trophies', 'final']);
    expect(w.hours).toMatchObject({ hasData: false, total: null, days: null, topMonth: null });
    expect(w.periodPartial).toBe(true);
    expect(w.longestGame.hasData).toBe(false);
  });

  it('будущий год: empty, 200, без падения; 2000 и 2100', async () => {
    for (const y of [2027, 2000, 2100]) {
      const w = await getWrapped(t.db, y, null, NOW);
      expect(w.mode).toBe('empty');
      expect(w.hours.byMonth).toHaveLength(12);
    }
  });

  // BUG-W1 (исправлен): hasData использует тот же критерий, что часы года (конец минус база).
  // Снимки 100 -> 90 -> 95: часов 0, hasData=false, mode empty.
  it('years[].hasData согласован с mode, когда значение падает и снова растёт', async () => {
    const a = await game(1);
    await t.db.insert(playtimeSnapshots).values([
      { gameId: a, snapshotDate: '2025-12-31', playDurationSeconds: 100 * 3600 },
      { gameId: a, snapshotDate: '2026-02-01', playDurationSeconds: 90 * 3600 },
      { gameId: a, snapshotDate: '2026-03-01', playDurationSeconds: 95 * 3600 },
    ]);
    const w = await getWrapped(t.db, 2026, null, NOW);
    expect(w.years.find((y) => y.year === 2026)?.hasData).toBe(w.mode === 'story');
  });

  it('hasData: год без часов, но с трофеем или статусом, остаётся true; год с падением часов и без событий false', async () => {
    const a = await game(1);
    const [s] = await t.db.insert(trophySets).values({ npCommunicationId: 'N1', npServiceName: 'trophy', name: 's' }).returning();
    await t.db.insert(playtimeSnapshots).values([
      { gameId: a, snapshotDate: '2024-12-31', playDurationSeconds: 100 * 3600 },
      { gameId: a, snapshotDate: '2025-02-01', playDurationSeconds: 90 * 3600 },
      { gameId: a, snapshotDate: '2025-03-01', playDurationSeconds: 95 * 3600 },
      { gameId: a, snapshotDate: '2026-02-01', playDurationSeconds: 90 * 3600 },
      { gameId: a, snapshotDate: '2026-03-01', playDurationSeconds: 95 * 3600 },
    ]);
    await t.db.insert(trophies).values({ trophySetId: s.id, trophyId: 0, type: 'bronze', earned: true, earnedAt: new Date('2025-06-01T00:00:00Z') });
    const w = await getWrapped(t.db, 2026, null, NOW);
    const has = (y: number) => w.years.find((r) => r.year === y)?.hasData;
    expect(has(2025)).toBe(true); // трофей
    expect(has(2026)).toBe(false); // база 95 (конец 2025), конец 95: часов 0, событий нет
    expect((await getWrapped(t.db, 2026, null, NOW)).mode).toBe('empty');
    expect((await getWrapped(t.db, 2025, null, NOW)).mode).toBe('story');
  });
});
