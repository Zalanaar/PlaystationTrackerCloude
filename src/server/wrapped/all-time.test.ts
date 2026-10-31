// Фаза 26: Итоги «за всё время» (контракт 26.2) на PGlite и чистые функции.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { getStats } from '@/server/stats/query';
import { busiestYear } from './all-compose';
import { getWrapped } from './query';
import { parseWrappedQuery } from './validation';

const { games, gameStatus, gameTrophySets, playtimeSnapshots, trophies, trophySets } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');

describe('parseWrappedQuery: year=all', () => {
  const q = (s: string) => parseWrappedQuery(new URLSearchParams(s), 2026);
  it('all принимается, регистр важен, остальное 400', () => {
    expect(q('year=all')).toEqual({ ok: true, value: { year: 'all' } });
    expect(q('year=2025')).toEqual({ ok: true, value: { year: 2025 } });
    expect(q('')).toEqual({ ok: true, value: { year: 2026 } });
    for (const b of ['year=ALL', 'year=all2', 'year=alle', 'year=-1', 'year=1999']) expect(q(b).ok, b).toBe(false);
  });
});

describe('busiestYear (чистая)', () => {
  it('максимум, ничья: ранний, нет часов: пусто', () => {
    expect(busiestYear([{ year: 2024, hours: 10, estimatedHours: 10 }, { year: 2025, hours: 10, estimatedHours: 0 }, { year: 2026, hours: 3, estimatedHours: 0 }])).toEqual({ hasData: true, year: 2024, hours: 10, estimated: true });
    expect(busiestYear([{ year: 2026, hours: 0, estimatedHours: 0 }])).toEqual({ hasData: false, year: null, hours: 0, estimated: false });
    expect(busiestYear([])).toEqual({ hasData: false, year: null, hours: 0, estimated: false });
  });
});

describe('getWrapped(year=all) на PGlite', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.execute(sql.raw(`insert into allowed_users (email, role, status) values ('b@example.com', 'member', 'active')`));
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function seed(u: typeof TEST_USER, name: string, trophyCount = 0) {
    const base = { userId: u, lastSeenAt: NOW, category: 'ps5_native_game' as const };
    const [a] = await t.db.insert(games).values({ ...base, titleId: 'A', name: `${name}-old`, psnGenres: ['ACTION'], playDurationSeconds: 36000, playCount: 7, firstPlayedAt: new Date('2024-02-01T10:00:00Z'), lastPlayedAt: new Date('2026-09-01T10:00:00Z') }).returning({ id: games.id });
    const [b] = await t.db.insert(games).values({ ...base, titleId: 'B', name: `${name}-new`, psnGenres: ['RACING'], playDurationSeconds: 7200, firstPlayedAt: new Date('2025-05-01T10:00:00Z'), lastPlayedAt: new Date('2026-09-02T10:00:00Z') }).returning({ id: games.id });
    // дубль старой игры с ещё более ранним первым запуском: первая игра = главная (дубль не отдельная карточка)
    await t.db.insert(games).values({ ...base, titleId: 'A4', name: `${name}-old`, category: 'ps4_game', psnGenres: ['ACTION'], playDurationSeconds: 3600, duplicateOfGameId: a.id, firstPlayedAt: new Date('2023-01-01T10:00:00Z') });
    await t.db.insert(playtimeSnapshots).values([
      { userId: u, gameId: a.id, snapshotDate: '2025-06-01', playDurationSeconds: 18000 },
      { userId: u, gameId: a.id, snapshotDate: '2026-10-20', playDurationSeconds: 36000 },
      { userId: u, gameId: b.id, snapshotDate: '2026-03-01', playDurationSeconds: 0 },
      { userId: u, gameId: b.id, snapshotDate: '2026-10-20', playDurationSeconds: 7200 },
    ]);
    await t.db.insert(gameStatus).values({ userId: u, gameId: a.id, status: 'completed', completedAt: new Date('2025-08-01T10:00:00Z') });
    const [set] = await t.db.insert(trophySets).values({ userId: u, npCommunicationId: 'NPWR_W', npServiceName: 'trophy', name: `${name} set`, definedBronze: 30 }).returning({ id: trophySets.id });
    await t.db.insert(gameTrophySets).values({ userId: u, gameId: a.id, trophySetId: set.id, source: 'title_id' });
    const rows: (typeof trophies.$inferInsert)[] = [
      { userId: u, trophySetId: set.id, trophyId: 0, type: 'platinum', name: 'Plat', earned: true, earnedAt: new Date('2025-07-01T19:00:00Z'), earnedRate: '3.00', rarity: 1 },
    ];
    for (let i = 1; i <= trophyCount; i++) rows.push({ userId: u, trophySetId: set.id, trophyId: i, type: 'bronze', name: `B${i}`, earned: true, earnedAt: new Date(Date.UTC(2026, 0, 1, 19, 0, 0) + i * 3600_000) });
    await t.db.insert(trophies).values(rows);
    return { a: a.id, b: b.id };
  }

  it('пустая БД: empty, allTimeAvailable = false', async () => {
    const r = await getWrapped(t.db, TEST_USER, 'all', null, NOW);
    expect(r.scope).toBe('all');
    expect(r.mode).toBe('empty');
    expect(r.slides).toEqual(['empty']);
    expect(r.allTimeAvailable).toBe(false);
    expect(r.period).toMatchObject({ from: null, to: null });
    expect(r.allTime?.firstGame).toEqual({ hasData: false, at: null, source: null, game: null });
  });

  it('набор: первая игра, часы, платины по годам, самый игровой год, жанр, самая долгая; сверка со Статистикой', async () => {
    const ids = await seed(TEST_USER, 'A');
    const r = await getWrapped(t.db, TEST_USER, 'all', null, NOW);
    const st = await getStats(t.db, TEST_USER, { type: 'all', year: 2026, month: null }, NOW);
    expect(r.mode).toBe('story');
    expect(r.allTimeAvailable).toBe(true);
    expect(r.allTime?.firstGame).toMatchObject({ hasData: true, source: 'first_played', at: '2023-01-01T10:00:00.000Z' });
    expect(r.allTime?.firstGame.game?.id).toBe(ids.a); // главная, а не дубль
    // 36000 + 3600 (дубль) + 7200 = 46800 с = 13 ч, как в Статистике
    expect(r.hours.total).toBe(13);
    expect(r.hours.total).toBe(st.header.hours);
    expect(r.hours.days).toBe(0.5);
    expect(r.allTime?.hoursByYear.byYear).toEqual(st.hours.byYear);
    expect(r.allTime?.hoursByYear.unattributed).toBe(st.hours.unattributed);
    const sum = r.allTime!.hoursByYear.byYear.reduce((s, y) => s + Math.round(y.hours * 10), 0) + Math.round(r.allTime!.hoursByYear.unattributed * 10);
    expect(sum).toBe(130);
    expect(r.allTime?.platinumByYear.items.find((y) => y.year === 2025)?.count).toBe(1);
    expect(r.allTime?.platinumByYear.total).toBe(1);
    expect(r.allTime?.busiestYear.hasData).toBe(true);
    expect(r.allTime?.topGenre).toMatchObject({ hasData: true, key: 'ACTION' });
    expect(r.longestGame.game?.id).toBe(ids.a);
    expect(r.longestGame.hours).toBe(11); // 39600 с с дублем
    expect(r.longestGame.estimated).toBe(false);
    expect(r.topGames.items.map((x) => x.game.id)).toEqual([ids.a, ids.b]);
    expect(r.trophies.platinum.first?.game?.id).toBe(ids.a);
    expect(r.finished.completed.count).toBe(1);
    expect(r.slides).toEqual(['start', 'firstGame', 'hours', 'platinumYears', 'busiestYear', 'genres', 'longestGame', 'final']);
    expect(r.playPattern?.hasData).toBe(false);
  });

  it('«Когда ты играешь»: слайд появляется при total >= 20; год и всё время', async () => {
    await seed(TEST_USER, 'A', 25); // 25 бронзовых 2026 + 1 платина 2025 = 26 трофеев
    const all = await getWrapped(t.db, TEST_USER, 'all', null, NOW);
    expect(all.playPattern?.total).toBe(26);
    expect(all.playPattern?.hasData).toBe(true);
    expect(all.slides).toContain('playPattern');
    expect(all.slides.indexOf('playPattern')).toBe(all.slides.indexOf('longestGame') + 1);
    const y26 = await getWrapped(t.db, TEST_USER, 2026, null, NOW);
    expect(y26.scope).toBe('year');
    expect(y26.allTime).toBeNull();
    expect(y26.playPattern?.total).toBe(25);
    expect(y26.slides).toContain('playPattern');
    expect(y26.slides.indexOf('playPattern')).toBe(y26.slides.indexOf('trophies') + 1);
    // 19:00..: час МСК = 22..., единственный пик определён
    expect(y26.playPattern?.byHour.reduce((s, n) => s + n, 0)).toBe(25);
    const y25 = await getWrapped(t.db, TEST_USER, 2025, null, NOW);
    expect(y25.playPattern).toMatchObject({ total: 1, hasData: false });
    expect(y25.slides).not.toContain('playPattern');
    expect(y25.allTimeAvailable).toBe(true);
  });

  it('запасной источник первой игры: самый ранний трофей, если first_played_at нет нигде', async () => {
    const base = { userId: 1, lastSeenAt: NOW, category: 'ps5_native_game' as const };
    const [a] = await t.db.insert(games).values({ ...base, titleId: 'Z', name: 'Z', playDurationSeconds: 100 }).returning({ id: games.id });
    const [set] = await t.db.insert(trophySets).values({ userId: 1, npCommunicationId: 'NPWR_Z', npServiceName: 'trophy', name: 'Z', definedBronze: 2 }).returning({ id: trophySets.id });
    await t.db.insert(gameTrophySets).values({ userId: 1, gameId: a.id, trophySetId: set.id, source: 'title_id' });
    await t.db.insert(trophies).values([
      { userId: 1, trophySetId: set.id, trophyId: 0, type: 'bronze', name: 'late', earned: true, earnedAt: new Date('2026-05-01T10:00:00Z') },
      { userId: 1, trophySetId: set.id, trophyId: 1, type: 'bronze', name: 'early', earned: true, earnedAt: new Date('2024-05-01T10:00:00Z') },
    ]);
    const r = await getWrapped(t.db, TEST_USER, 'all', null, NOW);
    expect(r.allTime?.firstGame).toMatchObject({ hasData: true, source: 'first_trophy', at: '2024-05-01T10:00:00.000Z' });
    expect(r.allTime?.firstGame.game?.id).toBe(a.id);
  });

  it('изоляция по user_id', async () => {
    await seed(TEST_USER, 'MARK_A', 25);
    await seed(TEST_USER_2, 'MARK_B', 0);
    const ra = await getWrapped(t.db, TEST_USER, 'all', null, NOW);
    const rb = await getWrapped(t.db, TEST_USER_2, 'all', null, NOW);
    expect(JSON.stringify(ra)).not.toContain('MARK_B');
    expect(JSON.stringify(rb)).not.toContain('MARK_A');
    expect(ra.playPattern?.total).toBe(26);
    expect(rb.playPattern?.total).toBe(1);
    expect(rb.trophies.counts.total).toBe(1);
  });
});
