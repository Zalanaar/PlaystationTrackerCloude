// QA Фазы 43: сценарии, которых нет в manual.test.ts (подтверждённый дубль и синк, «Hades» без запуска, шаг синка и чужие профили).
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { RunContext } from '@/server/sync/context';
import { manualMatchStep } from '@/server/sync/manual-match-step';
import { startRun } from '@/server/sync/runs';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { addManual, listManual, setNotPurchased } from './store';

const { games, allowedUsers, manualGames, syncRuns } = schema;
const U1 = TEST_USER;
const U3 = asUserId(3);
const NOW = new Date('2026-11-02T09:00:00Z');
const played = new Date('2026-10-30T10:00:00Z');
const add = (id: string, title: string, confirmDuplicate = false) => ({ externalSource: 'rawg' as const, externalId: id, title, coverUrl: null, releaseDate: null, ...(confirmDuplicate ? { confirmDuplicate } : {}) });

describe('QA-43', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insert(allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' });
    await t.db.insert(allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active', primaryUserId: 2, psnOnlineId: 'Second', psnAccountId: 'acc3' });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.db.delete(manualGames);
  });
  async function addGame(userId: number, name: string, o: Partial<typeof games.$inferInsert> = {}) {
    const [g] = await t.db.insert(games).values({ userId, category: 'ps5_native_game', lastSeenAt: NOW, titleId: `T${userId}-${name}`, name, psnGenres: ['ACTION'], ...o }).returning({ id: games.id });
    return g.id;
  }
  async function ctx(uid = U1) {
    await t.db.update(syncRuns).set({ status: 'success' }).where(eq(syncRuns.status, 'running'));
    const s = await startRun(t.db, uid, { kind: 'manual', now: NOW });
    if (s.kind !== 'started') throw new Error(s.kind);
    return new RunContext(t.db, s.run, () => NOW, 1_000_000);
  }

  it('QA-43-1: «Всё равно добавить» поверх запущенной игры библиотеки переживает ближайший синк', async () => {
    await addGame(1, 'Hades', { lastPlayedAt: played });
    await addManual(t.db, U1, add('10', 'Hades', true), NOW);
    await manualMatchStep(await ctx());
    expect((await listManual(t.db, U1)).map((x) => x.externalId)).toEqual(['10']);
  });

  it('QA-43-2: «Hades» в библиотеке без запуска + «Hades II» с запуском: вопрос про Hades II не задаётся, пока точная пара не запущена', async () => {
    await addGame(1, 'Hades');
    await addGame(1, 'Hades II', { lastPlayedAt: played });
    await addManual(t.db, U1, add('10', 'Hades', true), NOW);
    const r = await manualMatchStep(await ctx());
    expect(r.suggested).toBe(0);
  });

  it('шаг синка не трогает записи другого профиля того же входа', async () => {
    await addManual(t.db, U3, add('1', 'Alpha'), NOW);
    await addGame(1, 'Alpha', { lastPlayedAt: played });
    await manualMatchStep(await ctx(U1));
    expect(await listManual(t.db, U3)).toHaveLength(1);
  });

  it('«Купил» на склеенной записи: 404, не воскрешает', async () => {
    const { item } = await addManual(t.db, U1, add('1', 'Alpha'), NOW);
    await addGame(1, 'Alpha', { lastPlayedAt: played });
    await manualMatchStep(await ctx());
    await expect(setNotPurchased(t.db, U1, item.id, true)).rejects.toThrow();
  });
});
