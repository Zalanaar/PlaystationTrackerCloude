// Фаза 32 (QA): граничные случаи цели года и остатка часов, которых нет в тестах backend.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { computeGoal, GOAL_TOLERANCE } from './goal';
import { getGoal, putGoal, putSettings } from './db';
import { remainingHours } from '@/shared/remaining';

const { games, gameStatus } = schema;

const input = (o: Partial<Parameters<typeof computeGoal>[0]> = {}) => ({ mode: 'complete' as const, count: 12, year: 2026, today: '2026-07-02', completedInYear: 6, backlogNow: 20, ...o });

describe('QA-32: computeGoal, допуск и календарь', () => {
  it('допуск: diff ровно +1 = ahead, ровно -1 = behind, 0.99 = onTrack', () => {
    // 365 дней, 1 января: elapsed=1; done=d, perDay=d, daysLeft=364: forecast = d + d*364 = 365d
    const f = (count: number) => computeGoal(input({ today: '2026-01-01', completedInYear: 1, count }));
    expect(f(364).status).toBe('ahead');   // 365 - 364 = 1
    expect(f(366).status).toBe('behind');  // 365 - 366 = -1
    expect(f(365).status).toBe('onTrack'); // 0
    expect(GOAL_TOLERANCE).toBe(1);
  });
  it('високосный год: 366 дней, 29 февраля существует', () => {
    const g = computeGoal(input({ year: 2028, today: '2028-02-29', completedInYear: 2, count: 20 }));
    expect(g.asOf).toBe('2028-02-29');
    // прошло 60 дней, осталось 366-60 = 306
    expect(g.forecast).toBeCloseTo(2 + (2 / 60) * 306, 1);
  });
  it('count 1000 и current 0: не NaN и не бесконечность', () => {
    const g = computeGoal(input({ count: 1000, completedInYear: 0 }));
    for (const v of [g.forecast, g.requiredPerMonth, g.pacePerMonth, g.diff]) expect(Number.isFinite(v)).toBe(true);
    expect(g.status).toBe('behind');
  });
  it('backlog_to 0 при пустом бэклоге: achieved; при 1 игре и без темпа: behind', () => {
    expect(computeGoal(input({ mode: 'backlog_to', count: 0, backlogNow: 0 })).status).toBe('achieved');
    expect(computeGoal(input({ mode: 'backlog_to', count: 0, backlogNow: 1, completedInYear: 0 })).status).toBe('behind');
  });
  it('31 декабря: requiredPerMonth = 0 даже при невыполненной цели (нет дней), diff без деления на ноль', () => {
    const g = computeGoal(input({ today: '2026-12-31', completedInYear: 3, count: 12 }));
    expect(g.requiredPerMonth).toBe(0);
    expect(Number.isFinite(g.diff)).toBe(true);
    expect(g.status).toBe('behind');
  });
});

describe('QA-32: remainingHours, пороги', () => {
  it('ровно база наиграна: остаток 15% базы; чуть меньше порога 85%: база - наиграно', () => {
    expect(remainingHours(20, 20 * 3600)).toEqual({ remaining: 3, progress: 0.85 });
    expect(remainingHours(20, 16 * 3600)).toEqual({ remaining: 4, progress: 0.8 });
  });
  it('ручная оценка меньше наигранного: остаток = 15% оценки, а не 0', () => {
    expect(remainingHours(5, 50 * 3600).remaining).toBe(0.8); // 0.75 -> 0.8
  });
  it('QA-32-3: прогресс 0.845..0.849 после округления даёт 0.85 и UI примет это за «минимум 15%»', () => {
    // наиграно 84.6% базы: реальный остаток 15.4%, но progress = r2(0.846) = 0.85
    const r = remainingHours(100, 84.6 * 3600);
    expect(r.remaining).toBe(15.4);
    expect(r.progress).toBe(0.85); // = порог UI MINIMUM_PROGRESS: ложная пометка «мин. 15%»
  });
});

describe('QA-32: цель года и годы/МСК (БД)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); });
  const NOW = new Date('2026-07-01T09:00:00Z');
  async function done(title: string, status: 'completed' | 'dropped' | 'playing', at: Date | null) {
    const [g] = await t.db.insert(games).values({ userId: 1, titleId: title, name: title, category: 'ps5_native_game', lastSeenAt: NOW }).returning({ id: games.id });
    await t.db.insert(gameStatus).values({ userId: 1, gameId: g.id, status, ...(at && status === 'completed' ? { completedAt: at } : {}), ...(at && status === 'dropped' ? { droppedAt: at } : {}) });
  }

  it('границы года по МСК: ровно 00:00 МСК 1 января включено, 00:00 МСК следующего года нет; dropped и completed без даты не считаются', async () => {
    await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 10 });
    await done('start', 'completed', new Date('2025-12-31T21:00:00.000Z'));      // 2026-01-01 00:00 МСК: в 2026
    await done('just-before', 'completed', new Date('2025-12-31T20:59:59.999Z')); // в 2025
    await done('end', 'completed', new Date('2026-12-31T20:59:59.999Z'));         // 31 дек 23:59:59 МСК: в 2026
    await done('next', 'completed', new Date('2026-12-31T21:00:00.000Z'));        // 1 янв 2027 МСК
    await done('dropped', 'dropped', new Date('2026-05-01T10:00:00Z'));
    await done('nodate', 'completed', null);
    const g = await putGoal(t.db, TEST_USER, { mode: 'complete', count: 5 }, NOW);
    expect(g.current).toBe(2);
  });

  it('год настроек 2025 при today 2026: прошедший год, прогноз = факт, года из будущего не берёт', async () => {
    await putSettings(t.db, TEST_USER, { year: 2025, hoursPerWeek: 10 });
    await done('y25', 'completed', new Date('2025-06-01T10:00:00Z'));
    await done('y26', 'completed', new Date('2026-06-01T10:00:00Z'));
    const g = (await putGoal(t.db, TEST_USER, { mode: 'complete', count: 3 }, NOW));
    expect(g).toMatchObject({ year: 2025, current: 1, forecast: 1, requiredPerMonth: 0, status: 'behind' });
  });

  it('смена года в настройках: цель остаётся, считается по новому году', async () => {
    await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 10 });
    await putGoal(t.db, TEST_USER, { mode: 'complete', count: 3 }, NOW);
    await putSettings(t.db, TEST_USER, { year: 2027, hoursPerWeek: 10 });
    expect(await getGoal(t.db, TEST_USER, NOW)).toMatchObject({ year: 2027, count: 3, status: 'not_started', current: 0 });
  });
});
