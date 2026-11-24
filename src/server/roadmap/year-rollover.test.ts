// Автопереход плана и цели года 1 января: архив прошлого года, предложение перенести, старые данные на месте.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { applyPlannerRoll, getMonthGoals } from '@/server/goals/month-goals';
import { applyYearGoalRoll, getGoal, getSettings, getYearRolloverOffer, putGoal, putSettings } from './db';

const IN_2026 = new Date('2026-11-15T12:00:00Z');
const JAN1 = new Date('2026-12-31T21:00:00Z'); // 1 янв 2027 00:00 МСК
const JAN1_NOON = new Date('2027-01-01T09:00:00Z'); // 12:00 МСК 1 января

describe('автопереход года 1 января', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function seedGoal(count = 12, completed = 10) {
    await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 10 });
    await putGoal(t.db, TEST_USER, { mode: 'complete', count }, IN_2026);
    const ids: number[] = [];
    for (let i = 0; i < completed; i++) {
      const [g] = await t.db.insert(schema.games).values({
        userId: TEST_USER, titleId: `CUSA_Y${i}_00`, name: `Y${i}`, category: 'ps4_game', lastSeenAt: IN_2026,
      }).returning();
      ids.push(g.id);
    }
    await t.db.insert(schema.gameStatus).values(
      ids.map((id) => ({ userId: TEST_USER, gameId: id, status: 'completed' as const, completedAt: new Date('2026-06-01T12:00:00Z') })),
    );
  }

  it('1 января план переключается на новый год, цель архивируется, данные 2026 целы', async () => {
    await seedGoal();
    expect(await getSettings(t.db, TEST_USER, IN_2026)).toMatchObject({ year: 2026, hoursPerWeek: 10, configured: true });
    const before = await getGoal(t.db, TEST_USER, IN_2026);
    expect(before).toMatchObject({ mode: 'complete', year: 2026, current: 10, count: 12 });

    const settings = await getSettings(t.db, TEST_USER, JAN1);
    expect(settings).toEqual({ year: 2027, hoursPerWeek: 10, configured: true });
    expect(await getGoal(t.db, TEST_USER, JAN1)).toBeNull();
    const offer = await getYearRolloverOffer(t.db, TEST_USER, JAN1);
    expect(offer).toEqual({ fromYear: 2026, toYear: 2027, mode: 'complete', count: 12, current: 10 });

    const archived = await t.db.select().from(schema.roadmapYearGoals).where(eq(schema.roadmapYearGoals.userId, TEST_USER));
    expect(archived).toMatchObject([{ year: 2026, mode: 'complete', count: 12, carryState: 'pending' }]);

    // повторный вызов не дублирует архив и не трогает уже новый год
    expect(await getSettings(t.db, TEST_USER, JAN1_NOON)).toEqual({ year: 2027, hoursPerWeek: 10, configured: true });
    const again = await t.db.select().from(schema.roadmapYearGoals).where(eq(schema.roadmapYearGoals.userId, TEST_USER));
    expect(again).toHaveLength(1);

    const home = await getMonthGoals(t.db, TEST_USER, JAN1);
    expect(home.year).toBe(2027);
    expect(home.yearGoal).toBeNull();
    expect(home.yearRollover).toEqual(offer);
  });

  it('перенос цели на 2027, архив 2026 остаётся', async () => {
    await seedGoal();
    const carried = await applyPlannerRoll(t.db, TEST_USER, JAN1, 'year', 'carry');
    expect(carried.yearRollover).toBeNull();
    expect(carried.yearGoal).toMatchObject({ mode: 'complete', year: 2027, count: 12 });
    expect(await getGoal(t.db, TEST_USER, JAN1)).toMatchObject({ mode: 'complete', year: 2027, count: 12 });
    const archived = await t.db.select().from(schema.roadmapYearGoals).where(eq(schema.roadmapYearGoals.userId, TEST_USER));
    expect(archived).toMatchObject([{ year: 2026, mode: 'complete', count: 12, carryState: 'carried' }]);
    // прогресс 2026 по-прежнему считается из прохождений того года
    expect(archived[0]?.count).toBe(12);
  });

  it('отказ от переноса: в 2027 цели нет, архив сохранён', async () => {
    await seedGoal();
    await applyYearGoalRoll(t.db, TEST_USER, JAN1, 'dismiss');
    expect(await getGoal(t.db, TEST_USER, JAN1)).toBeNull();
    expect(await getYearRolloverOffer(t.db, TEST_USER, JAN1)).toBeNull();
    const archived = await t.db.select().from(schema.roadmapYearGoals).where(eq(schema.roadmapYearGoals.userId, TEST_USER));
    expect(archived).toMatchObject([{ year: 2026, carryState: 'dismissed', count: 12 }]);
  });

  it('после автоперехода ручной возврат к 2026 не переключает год снова', async () => {
    await seedGoal();
    await getSettings(t.db, TEST_USER, JAN1);
    await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 8 });
    expect(await getSettings(t.db, TEST_USER, JAN1)).toEqual({ year: 2026, hoursPerWeek: 8, configured: true });
  });
});
