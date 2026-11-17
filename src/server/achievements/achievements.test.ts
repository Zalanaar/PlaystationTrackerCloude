// П13.1: сборка вех (цель, значение, дата N-го события), PGlite: пройденные (видимые, по дате), платины, 1000-й трофей,
// ультраредкий (<1%), часы (без скрытых), «Марафон» (часы с дублями), жанры пройденных, оценки, изоляция пользователей.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { buildAchievements, getAchievements } from './achievements';

const { games, gameStatus, trophySets, trophies, gameReviews } = schema;
const NOW = new Date('2026-11-16T21:00:00Z');
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const empty = {
  completedAt: [], platinumAt: [], trophyCount: 0, trophy1000At: null, ultraRareAt: null, ultraRareCount: 0,
  totalSeconds: 0, maxGame: null, genres: 0, rated: 0,
};

describe('buildAchievements', () => {
  it('пусто: 12 вех, ничего не получено', () => {
    const r = buildAchievements(empty);
    expect(r.total).toBe(12);
    expect(r.unlocked).toBe(0);
    expect(r.items.every((i) => !i.unlocked && i.at === null && i.detail === null)).toBe(true);
  });
  it('даты N-го события и подпись марафона', () => {
    const dates = Array.from({ length: 12 }, (_, i) => ago(100 - i));
    const r = buildAchievements({ ...empty, completedAt: dates, totalSeconds: 150 * 3600, maxGame: { title: ' Elden Ring ', seconds: 120 * 3600 }, genres: 5, rated: 3 });
    const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
    expect(by.completed_1.at).toBe(ago(100).toISOString());
    expect(by.completed_10.at).toBe(ago(91).toISOString());
    expect(by.completed_50).toMatchObject({ unlocked: false, value: 12, at: null });
    expect(by.hours_100).toMatchObject({ unlocked: true, value: 150, at: null });
    expect(by.hours_1000.unlocked).toBe(false);
    expect(by.marathon).toMatchObject({ unlocked: true, value: 120, detail: 'Elden Ring' });
    expect(by.genres_5.unlocked).toBe(true);
    expect(by.critic_10).toMatchObject({ unlocked: false, value: 3 });
    expect(r.unlocked).toBe(5);
  });
  it('пройдена без даты: получено, дата null', () => {
    const r = buildAchievements({ ...empty, completedAt: [null] });
    expect(r.items[0]).toMatchObject({ id: 'completed_1', unlocked: true, at: null });
  });
});

describe('getAchievements (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.pg.execute(sql`insert into allowed_users (email, role, status) values ('m@example.com', 'member', 'active')`);
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  let n = 0;
  async function game(name: string, o: { status?: 'completed' | 'backlog'; done?: number | null; secs?: number; hidden?: boolean; dupOf?: number; genres?: string[]; user?: number; rating?: number } = {}) {
    n += 1;
    const userId = o.user ?? TEST_USER;
    const [g] = await t.db.insert(games).values({
      userId, titleId: `CUSA${n}_00`, name, category: 'ps4_game', lastSeenAt: NOW, playDurationSeconds: o.secs ?? 0,
      hiddenAt: o.hidden ? NOW : null, duplicateOfGameId: o.dupOf ?? null, psnGenres: o.genres ?? [],
    }).returning();
    if (o.status) await t.db.insert(gameStatus).values({ userId, gameId: g.id, status: o.status, completedAt: o.status === 'completed' && o.done !== null ? ago(o.done ?? 1) : null });
    if (o.rating !== undefined) await t.db.insert(gameReviews).values({ userId, gameId: g.id, rating: o.rating });
    return g.id;
  }
  let tid = 0;
  async function trophy(type: 'platinum' | 'gold' | 'bronze', daysAgo: number | null, rate: string | null = '50', user = TEST_USER) {
    const [s] = await t.db.insert(trophySets).values({ userId: user, npCommunicationId: `NPWR${++tid}`, npServiceName: 'trophy2', name: 'S' }).returning();
    await t.db.insert(trophies).values({ userId: user, trophySetId: s.id, trophyId: tid, type, earned: true, earnedAt: daysAgo === null ? null : ago(daysAgo), earnedRate: rate });
  }

  it('сбор фактов', async () => {
    await game('A', { status: 'completed', done: 30, genres: ['ACTION'], secs: 50 * 3600, rating: 8 });
    await game('B', { status: 'completed', done: 300, genres: ['RPG'] });
    await game('C', { status: 'completed', done: null, genres: ['ACTION', 'PUZZLE'] });
    await game('Hidden', { status: 'completed', done: 400, hidden: true, secs: 1000 * 3600, genres: ['RACING'], rating: 5 });
    const main = await game('Main', { status: 'backlog', secs: 70 * 3600 });
    await game('Main PS5', { secs: 40 * 3600, dupOf: main }); // +40 ч к Main → 110 ч
    await game('Other', { status: 'completed', done: 500, user: TEST_USER_2, secs: 2000 * 3600 });
    await trophy('platinum', 10);
    await trophy('platinum', 100, '0.80');
    await trophy('gold', 5, '0.50');
    await trophy('bronze', null, '0.10');
    await trophy('platinum', 1, '0.1', TEST_USER_2);
    const r = await getAchievements(t.db, asUserId(TEST_USER));
    const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
    expect(by.completed_1).toMatchObject({ value: 3, unlocked: true, at: ago(300).toISOString() });
    expect(by.platinum_1).toMatchObject({ value: 2, at: ago(100).toISOString() });
    expect(by.trophies_1000).toMatchObject({ value: 4, unlocked: false });
    expect(by.ultra_rare).toMatchObject({ value: 3, unlocked: true, at: ago(100).toISOString() });
    expect(by.hours_100).toMatchObject({ value: 160, unlocked: true }); // 50 + 70 + 40, без скрытой
    expect(by.marathon).toMatchObject({ value: 110, unlocked: true, detail: 'Main' });
    expect(by.genres_5.value).toBe(3);
    expect(by.critic_10.value).toBe(1);
  });
});
