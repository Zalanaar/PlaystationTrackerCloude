// Фаза 36: база пройдена, DLC нет: платина не блокируется в «ближе к платине» (15.3). PGlite.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { getNearPlatinumCandidates } from './platinum-query';

const { games, gameStatus, trophySets, gameTrophySets, trophies, allowedUsers } = schema;
const NOW = new Date('2026-10-29T09:00:00Z');

describe('прогноз платины: база пройдена, DLC не выполнен', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function seedGame(userId: number, title: string, groups: { base: string | null; dlc: string | null }) {
    const [g] = await t.db.insert(games).values({ userId, category: 'ps5_native_game', lastSeenAt: NOW, titleId: title, name: title }).returning({ id: games.id });
    await t.db.insert(gameStatus).values({ userId, gameId: g.id, status: 'playing' });
    const [s] = await t.db.insert(trophySets).values({ userId, npCommunicationId: `NP_${title}`, npServiceName: 'trophy', name: title }).returning({ id: trophySets.id });
    await t.db.insert(gameTrophySets).values({ userId, gameId: g.id, trophySetId: s.id, source: 'manual' });
    // база: бронза 1 (получена), бронза 2 (получена); DLC: бронза 3, 4 (не получены); платина не получена
    await t.db.insert(trophies).values([
      { userId, trophySetId: s.id, trophyId: 1, groupId: groups.base, type: 'bronze', earned: true },
      { userId, trophySetId: s.id, trophyId: 2, groupId: groups.base, type: 'bronze', earned: true },
      { userId, trophySetId: s.id, trophyId: 0, groupId: groups.base, type: 'platinum', earned: false },
      { userId, trophySetId: s.id, trophyId: 3, groupId: groups.dlc, type: 'bronze', earned: false },
      { userId, trophySetId: s.id, trophyId: 4, groupId: groups.dlc, type: 'bronze', earned: false },
    ]);
    return g.id;
  }

  it('DLC вынесен: прогресс 100%, remaining 0, dlc отдельно, не приблизительно', async () => {
    const id = await seedGame(TEST_USER, 'G', { base: 'default', dlc: '001' });
    const [c] = await getNearPlatinumCandidates(t.db, TEST_USER);
    expect(c.gameId).toBe(id);
    expect(c.forecast).toMatchObject({ required: 2, earned: 2, progress: 100, remaining: { total: 0 }, approximate: false, dlc: { required: 2, earned: 0, remaining: 2 } });
  });

  it('group_id неизвестен (NULL): прежнее поведение, DLC в базе, приблизительно', async () => {
    await seedGame(TEST_USER, 'G', { base: null, dlc: null });
    const [c] = await getNearPlatinumCandidates(t.db, TEST_USER);
    expect(c.forecast).toMatchObject({ required: 4, earned: 2, approximate: true, dlc: null });
  });

  it('изоляция по user_id: у второго пользователя свои данные', async () => {
    await seedGame(TEST_USER, 'G', { base: 'default', dlc: '001' });
    const [u2] = await t.db.insert(allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' }).returning({ id: allowedUsers.id });
    expect(await getNearPlatinumCandidates(t.db, u2.id as typeof TEST_USER)).toEqual([]);
    await seedGame(u2.id, 'G', { base: null, dlc: null });
    const [c1] = await getNearPlatinumCandidates(t.db, TEST_USER);
    const [c2] = await getNearPlatinumCandidates(t.db, u2.id as typeof TEST_USER);
    expect(c1.forecast.required).toBe(2);
    expect(c2.forecast.required).toBe(4);
  });
});
