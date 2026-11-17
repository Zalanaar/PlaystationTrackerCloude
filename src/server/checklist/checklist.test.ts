// П13.4: «Первая неделя» — 7 дней от онбординга (иначе от создания), «Скрыть» насовсем, пункты по данным
// (синк, статусы до 5 или всех игр, HLTB, Telegram), скрытые игры не считаются.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { dismissChecklist, getChecklist, WEEK_MS } from './checklist';

const { allowedUsers, games, gameStatus, syncRuns, telegramChats } = schema;
const START = new Date('2026-11-10T09:00:00Z');
const U = asUserId(TEST_USER);

describe('«Первая неделя» (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.db.update(allowedUsers).set({ onboardedAt: START }).where(eq(allowedUsers.id, TEST_USER));
  });

  let n = 0;
  async function game(o: { hidden?: boolean; status?: 'backlog' | 'completed'; hltb?: boolean } = {}) {
    n += 1;
    const [g] = await t.db.insert(games).values({
      userId: TEST_USER, titleId: `CUSA${n}_00`, name: `G${n}`, category: 'ps4_game', lastSeenAt: START, hiddenAt: o.hidden ? START : null,
      hltbCheckedAt: o.hltb ? START : null,
    }).returning();
    if (o.status) await t.db.insert(gameStatus).values({ gameId: g.id, userId: TEST_USER, status: o.status });
    return g.id;
  }

  it('новый пользователь: показ, всё не сделано; цель статусов — не больше числа игр', async () => {
    await game();
    await game();
    const r = await getChecklist(t.db, U, new Date(START.getTime() + 3600_000));
    expect(r.show).toBe(true);
    expect(r.endsAt).toBe(new Date(START.getTime() + WEEK_MS).toISOString());
    expect(r.items).toEqual({ sync: false, statuses: { count: 0, goal: 2, done: false }, hltb: false, telegram: false });
  });

  it('пункты по данным; скрытые игры в статусах не считаются; HLTB-синк не синк', async () => {
    for (let i = 0; i < 5; i += 1) await game({ status: 'backlog' });
    await game({ status: 'completed', hidden: true });
    await game({ hltb: true });
    await t.db.insert(syncRuns).values({ userId: TEST_USER, kind: 'hltb', status: 'success', snapshotDate: '2026-11-10' });
    let r = await getChecklist(t.db, U, START);
    expect(r.items?.sync).toBe(false);
    await t.db.insert(syncRuns).values({ userId: TEST_USER, kind: 'manual', status: 'partial', snapshotDate: '2026-11-10' });
    await t.db.insert(telegramChats).values({ userId: TEST_USER, chatId: '12345' });
    r = await getChecklist(t.db, U, START);
    expect(r.items).toEqual({ sync: true, statuses: { count: 5, goal: 5, done: true }, hltb: true, telegram: true });
  });

  it('после недели и после «Скрыть» — не показывать', async () => {
    expect((await getChecklist(t.db, U, new Date(START.getTime() + WEEK_MS))).show).toBe(false);
    await dismissChecklist(t.db, U, START);
    const r = await getChecklist(t.db, U, START);
    expect(r).toMatchObject({ show: false, items: null });
  });

  it('без онбординга — неделя от создания пользователя', async () => {
    await t.db.update(allowedUsers).set({ onboardedAt: null, createdAt: START }).where(eq(allowedUsers.id, TEST_USER));
    expect((await getChecklist(t.db, U, new Date(START.getTime() + WEEK_MS - 1))).show).toBe(true);
    expect((await getChecklist(t.db, asUserId(999), START))).toEqual({ show: false, endsAt: null, items: null });
  });
});
