// Пакет 3: «Лучшая игра года» по моей оценке — чистый выбор, сборка слайда и выборка из БД (PGlite).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import type { GameItem } from '@/server/collection/types';
import { createTestDb, type TestDb, TEST_USER, TEST_USER_2 } from '@/server/sync/test-helpers';
import { pickBestGame } from './calc';
import { composeWrapped, type WrappedInput } from './compose';
import { getWrapped } from './query';

const H = 3600;
const game = (id: number, title: string): GameItem => ({
  id, title, coverUrl: null, platform: 'PS5', playSeconds: 0, hours: 0, playCount: 1, lastPlayedAt: null, status: null,
  completedAt: null, droppedAt: null, trophies: null, genres: [], bannerUrl: null,
});
const byId = new Map([1, 2, 3, 4].map((i) => [i, game(i, `G${i}`)]));

describe('pickBestGame', () => {
  it('наивысшая оценка среди игранных в году или пройденных; ничья — больше часов, затем название', () => {
    const sec = new Map([[1, 10 * H], [2, 30 * H], [3, 0]]);
    // 4 оценена 10, но в году не играна и не пройдена — не кандидат
    expect(pickBestGame(new Map([[1, 9], [2, 9], [4, 10]]), sec, [], byId).game?.id).toBe(2);
    expect(pickBestGame(new Map([[1, 9], [2, 8]]), sec, [], byId)).toMatchObject({ hasData: true, rating: 9, hours: 10 });
    // пройдена в году без часов (например, вне PSN) — кандидат
    expect(pickBestGame(new Map([[1, 7], [3, 8]]), sec, [3], byId).game?.id).toBe(3);
    expect(pickBestGame(new Map([[1, 5], [2, 5]]), new Map([[1, H], [2, H]]), [], byId).game?.id).toBe(1);
    expect(pickBestGame(new Map(), sec, [], byId)).toEqual({ hasData: false, rating: null, hours: 0, estimated: false, game: null });
  });
  it('оценка 0 — тоже оценка', () => expect(pickBestGame(new Map([[1, 0]]), new Map([[1, H]]), [], byId).rating).toBe(0));
});

describe('composeWrapped: слайд bestGame', () => {
  const base = (o: Partial<WrappedInput>): WrappedInput => ({
    year: 2026, today: '2026-10-27', years: [{ year: 2026, hasData: true }], onlineId: 'me', avatarUrl: null,
    snapshots: [{ gameId: 1, date: '2026-01-05', seconds: 0 }, { gameId: 1, date: '2026-03-01', seconds: 5 * H }], estimates: [], firstSnapshotDate: '2025-01-01',
    trophies: [], platinums: [], finishedEvents: [], gameById: byId, genreGames: new Map(), ...o,
  });
  it('есть оценённая игра года — слайд перед final', () => {
    const w = composeWrapped(base({ ratings: new Map([[1, 8]]) }));
    expect(w.slides.slice(-2)).toEqual(['bestGame', 'final']);
    expect(w.bestGame).toMatchObject({ hasData: true, rating: 8, hours: 5, game: { id: 1 } });
  });
  it('без оценок (или старый вызов) — слайда нет', () => {
    const w = composeWrapped(base({}));
    expect(w.slides).not.toContain('bestGame');
    expect(w.bestGame?.hasData).toBe(false);
  });
});

describe('getWrapped: оценки из game_reviews (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => t.reset());
  const NOW = new Date('2026-10-27T10:00:00Z');
  const { games, gameReviews, playtimeSnapshots } = schema;

  it('берёт мою оценку игры, игранной в году; чужие оценки и прошлогодние игры не учитываются', async () => {
    await t.pg.execute(sql`insert into allowed_users (id, email, role, status) overriding system value values (2, 'b@example.com', 'member', 'active') on conflict do nothing`);
    const ins = async (userId: typeof TEST_USER, n: number, name: string) => (await t.db.insert(games).values({ userId, titleId: `CUSA${n}_00`, name, category: 'ps5_native_game', lastSeenAt: NOW }).returning())[0].id;
    const a = await ins(TEST_USER, 1, 'Astro Bot');
    const b = await ins(TEST_USER, 2, 'Old Game');
    const c = await ins(TEST_USER, 3, 'Mid Game');
    const other = await ins(TEST_USER_2, 4, 'Other');
    await t.db.insert(playtimeSnapshots).values([
      { userId: TEST_USER, gameId: a, snapshotDate: '2026-01-02', playDurationSeconds: 0 },
      { userId: TEST_USER, gameId: a, snapshotDate: '2026-05-02', playDurationSeconds: 20 * H },
      { userId: TEST_USER, gameId: c, snapshotDate: '2026-01-02', playDurationSeconds: 0 },
      { userId: TEST_USER, gameId: c, snapshotDate: '2026-05-02', playDurationSeconds: 40 * H },
      { userId: TEST_USER, gameId: b, snapshotDate: '2024-05-02', playDurationSeconds: 50 * H },
      { userId: TEST_USER_2, gameId: other, snapshotDate: '2026-05-02', playDurationSeconds: 5 * H },
    ]);
    await t.db.insert(gameReviews).values([
      { userId: TEST_USER, gameId: a, rating: 9 },
      { userId: TEST_USER, gameId: c, rating: 7 },
      { userId: TEST_USER, gameId: b, rating: 10 },
      { userId: TEST_USER_2, gameId: other, rating: 10 },
    ]);
    const w = await getWrapped(t.db, TEST_USER, 2026, 'me', NOW);
    expect(w.slides).toContain('bestGame');
    expect(w.bestGame).toMatchObject({ hasData: true, rating: 9, game: { id: a, title: 'Astro Bot' } });
    const all = await getWrapped(t.db, TEST_USER, 'all', 'me', NOW);
    expect(all.slides).not.toContain('bestGame');
  });
});
