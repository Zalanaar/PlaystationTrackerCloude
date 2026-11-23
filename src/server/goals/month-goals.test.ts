// Цели месяца: разбор тела, прогресс (границы МСК, скрытые, чужой профиль), сохранение и снятие.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { currentMonth, getMonthGoals, hasGoals, parseGoals, saveMonthGoals } from './month-goals';

const NOW = new Date('2026-11-15T12:00:00Z'); // 15:00 МСК 15 ноября
const MSK_NOV1 = new Date('2026-10-31T21:00:00Z'); // 00:00 МСК 1 ноября
const beforeNov = new Date('2026-10-31T20:59:00Z'); // ещё октябрь МСК

describe('разбор и месяц', () => {
  it('текущий месяц МСК', () => {
    expect(currentMonth(new Date('2026-11-30T20:59:00Z'))).toEqual({ month: '2026-11', year: 2026, monthNum: 11 });
    expect(currentMonth(new Date('2026-11-30T21:00:00Z'))).toEqual({ month: '2026-12', year: 2026, monthNum: 12 });
  });
  it('разбор тела', () => {
    expect(parseGoals({ games: 3, hours: 20, trophies: 50 })).toEqual({ ok: true, value: { games: 3, hours: 20, trophies: 50 } });
    expect(parseGoals({ games: 3 })).toEqual({ ok: true, value: { games: 3, hours: null, trophies: null } });
    expect(parseGoals({ games: null, hours: null, trophies: null })).toEqual({ ok: true, value: { games: null, hours: null, trophies: null } });
    expect(parseGoals({ games: 0 })).toEqual({ ok: false });
    expect(parseGoals({ games: 101 })).toEqual({ ok: false });
    expect(parseGoals({ hours: 745 })).toEqual({ ok: false });
    expect(parseGoals({ trophies: 1.5 })).toEqual({ ok: false });
    expect(parseGoals({ extra: 1 })).toEqual({ ok: false });
    expect(parseGoals(null)).toEqual({ ok: false });
    expect(hasGoals({ games: 1, hours: null, trophies: null })).toBe(true);
    expect(hasGoals({ games: null, hours: null, trophies: null })).toBe(false);
    expect(hasGoals({ games: null, hours: null, trophies: 10 })).toBe(false);
    expect(parseGoals({ gameIds: [3, 1, 3] })).toEqual({ ok: true, value: { games: 2, hours: null, trophies: null, gameIds: [3, 1] } });
    expect(parseGoals({ gameIds: [] })).toEqual({ ok: true, value: { games: null, hours: null, trophies: null, gameIds: [] } });
    expect(parseGoals({ gameIds: [0] })).toEqual({ ok: false });
    expect(parseGoals({ gameIds: 1 })).toEqual({ ok: false });
  });
});

describe('на PGlite', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.db.insert(schema.allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' }).onConflictDoNothing();
  });

  let n = 0;
  async function game(opts: { userId?: number; hidden?: boolean; name?: string } = {}) {
    n += 1;
    const userId = opts.userId ?? TEST_USER;
    const [g] = await t.db.insert(schema.games).values({
      userId, titleId: `CUSA${n}_00`, name: opts.name ?? `G${n}`, category: 'ps4_game', lastSeenAt: NOW,
      hiddenAt: opts.hidden ? NOW : null,
    }).returning();
    return g.id;
  }

  it('пусто: целей нет, прогресс ноль', async () => {
    const v = await getMonthGoals(t.db, TEST_USER, NOW);
    expect(v).toMatchObject({ month: '2026-11', hasGoals: false, goals: { games: null, hours: null, trophies: null }, progress: { games: 0, hours: 0, trophies: 0 } });
  });

  it('сохранение, правка и снятие; чужой профиль не видит', async () => {
    const saved = await saveMonthGoals(t.db, TEST_USER, NOW, { games: 3, hours: 20, trophies: null });
    expect(saved).toMatchObject({ hasGoals: true, goals: { games: 3, hours: 20, trophies: null } });
    const edited = await saveMonthGoals(t.db, TEST_USER, NOW, { games: 2, hours: null, trophies: 40 });
    expect(edited.goals).toEqual({ games: 2, hours: null, trophies: 40 });
    const other = await getMonthGoals(t.db, TEST_USER_2, NOW);
    expect(other.hasGoals).toBe(false);
    const cleared = await saveMonthGoals(t.db, TEST_USER, NOW, { games: null, hours: null, trophies: null });
    expect(cleared.hasGoals).toBe(false);
  });

  it('прогресс: пройдено в месяце МСК, скрытые и чужой профиль — нет; часы по снимкам; трофеи', async () => {
    const a = await game({ name: 'A' });
    const b = await game({ name: 'B' });
    const hidden = await game({ name: 'H', hidden: true });
    const otherG = await game({ name: 'O', userId: TEST_USER_2 });
    await t.db.insert(schema.gameStatus).values([
      { userId: TEST_USER, gameId: a, status: 'completed', completedAt: MSK_NOV1 },
      { userId: TEST_USER, gameId: b, status: 'completed', completedAt: beforeNov },
      { userId: TEST_USER, gameId: hidden, status: 'completed', completedAt: NOW },
      { userId: TEST_USER_2, gameId: otherG, status: 'completed', completedAt: NOW },
    ]);
    await t.db.insert(schema.playtimeSnapshots).values([
      { userId: TEST_USER, gameId: a, snapshotDate: '2026-10-31', playDurationSeconds: 3600 },
      { userId: TEST_USER, gameId: a, snapshotDate: '2026-11-10', playDurationSeconds: 3600 + 5 * 3600 },
      { userId: TEST_USER, gameId: hidden, snapshotDate: '2026-11-10', playDurationSeconds: 99 * 3600 },
      { userId: TEST_USER_2, gameId: otherG, snapshotDate: '2026-11-10', playDurationSeconds: 99 * 3600 },
    ]);
    const [set] = await t.db.insert(schema.trophySets).values({
      userId: TEST_USER, npCommunicationId: 'NPWR1', npServiceName: 'trophy', name: 'S',
    }).returning();
    await t.db.insert(schema.trophies).values([
      { userId: TEST_USER, trophySetId: set.id, trophyId: 0, type: 'bronze', earned: true, earnedAt: NOW },
      { userId: TEST_USER, trophySetId: set.id, trophyId: 1, type: 'gold', earned: true, earnedAt: beforeNov },
      { userId: TEST_USER, trophySetId: set.id, trophyId: 2, type: 'silver', earned: false },
    ]);
    const v = await getMonthGoals(t.db, TEST_USER, NOW);
    expect(v.progress).toEqual({ games: 1, hours: 5, trophies: 1 });
    expect(v.picked).toEqual([]);
    expect(v.hoursHint).toBeNull();
  });

  it('выбранные игры: прогресс по «Пройдено», кандидаты из «Играю» и Плана', async () => {
    const playing = await game({ name: 'GTA' });
    const planned = await game({ name: 'PlanA' });
    const done = await game({ name: 'Old' });
    await t.db.insert(schema.gameStatus).values([
      { userId: TEST_USER, gameId: playing, status: 'playing' },
      { userId: TEST_USER, gameId: planned, status: 'backlog' },
      { userId: TEST_USER, gameId: done, status: 'completed', completedAt: NOW },
    ]);
    await t.db.insert(schema.roadmapOrder).values({ userId: TEST_USER, gameId: planned, position: 0, updatedAt: NOW });
    const empty = await getMonthGoals(t.db, TEST_USER, NOW);
    expect(empty.candidates.playing.map((g) => g.title)).toEqual(['GTA']);
    expect(empty.candidates.plan.map((g) => g.title)).toEqual(['PlanA']);
    expect(empty.candidates.playing[0].id).toBe(playing);

    const saved = await saveMonthGoals(t.db, TEST_USER, NOW, { games: null, hours: null, trophies: null, gameIds: [playing, planned] });
    expect(saved.hasGoals).toBe(true);
    expect(saved.goals.games).toBe(2);
    expect(saved.picked.map((g) => g.title)).toEqual(['GTA', 'PlanA']);
    expect(saved.progress.games).toBe(0);
    expect(saved.candidates.playing).toEqual([]);
    expect(saved.candidates.plan).toEqual([]);

    await t.db.update(schema.gameStatus).set({ status: 'completed', completedAt: NOW }).where(eq(schema.gameStatus.gameId, playing));
    const after = await getMonthGoals(t.db, TEST_USER, NOW);
    expect(after.progress.games).toBe(1);
    expect(after.picked.find((g) => g.id === playing)?.completed).toBe(true);
    expect(after.picked.find((g) => g.id === planned)?.completed).toBe(false);

    const other = await getMonthGoals(t.db, TEST_USER_2, NOW);
    expect(other.picked).toEqual([]);
    expect(other.hasGoals).toBe(false);
  });

  it('подсказка часов: среднее за прошедшие месяцы со снимками', async () => {
    const g = await game({ name: 'H' });
    await t.db.insert(schema.playtimeSnapshots).values([
      { userId: TEST_USER, gameId: g, snapshotDate: '2026-08-31', playDurationSeconds: 5 * 3600 },
      { userId: TEST_USER, gameId: g, snapshotDate: '2026-09-30', playDurationSeconds: 15 * 3600 },
      { userId: TEST_USER, gameId: g, snapshotDate: '2026-10-31', playDurationSeconds: 35 * 3600 },
    ]);
    const v = await getMonthGoals(t.db, TEST_USER, NOW);
    // сентябрь +10 ч, октябрь +20 ч (снимок 31.08 — база); среднее 15.
    expect(v.hoursHint).toBe(15);
  });
});
