import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { schema } from '@/db';
import { NotFoundError } from '@/server/collection/mutations';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { getHunts, HuntConflictError, HuntLimitError, HUNT_TROPHY_LIMIT, setHuntGame, setHuntTrophy } from './hunts';

const { allowedUsers, games, gameTrophySets, huntGames, huntTrophies, trophies, trophySets } = schema;

describe('охота: закрепить игру и трофеи', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.db.insert(allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' }).onConflictDoNothing();
  });

  async function game(name = 'Hades', o: { userId?: number; hidden?: boolean } = {}) {
    const userId = o.userId ?? TEST_USER;
    const [g] = await t.db.insert(games).values({
      userId, titleId: `CUSA-${name}-${userId}`, name, category: 'ps5_native_game', lastSeenAt: new Date(), hiddenAt: o.hidden ? new Date() : null,
    }).returning();
    return g;
  }

  async function setWithTrophies(gameId: number, opts: { platEarned?: boolean; userId?: number; extraUnearned?: number } = {}) {
    const userId = opts.userId ?? TEST_USER;
    const platEarned = !!opts.platEarned;
    const extra = opts.extraUnearned ?? 2;
    const [s] = await t.db.insert(trophySets).values({
      userId, npCommunicationId: `NPWR-${gameId}`, npServiceName: 'trophy2', name: 'S',
      definedPlatinum: 1, earnedPlatinum: platEarned ? 1 : 0,
      definedBronze: extra, earnedBronze: 0,
    }).returning();
    await t.db.insert(gameTrophySets).values({ gameId, trophySetId: s.id, userId, source: 'title_id' });
    await t.db.insert(trophies).values([
      { userId, trophySetId: s.id, trophyId: 0, type: 'platinum', name: 'Платина', earned: platEarned, earnedAt: platEarned ? new Date() : null },
      ...Array.from({ length: extra }, (_, i) => ({ userId, trophySetId: s.id, trophyId: i + 1, type: 'bronze' as const, name: `T${i + 1}`, earned: false })),
    ]);
    return s;
  }

  it('закрепляет игру с прогрессом; чужая и скрытая — 404; платина уже есть — конфликт; null снимает', async () => {
    const g = await game();
    await setWithTrophies(g.id);
    const v = await setHuntGame(t.db, TEST_USER, g.id);
    expect(v.game).toMatchObject({ id: g.id, title: 'Hades', defined: 3, earned: 0, remaining: 3, platEarned: false });

    const hidden = await game('Hid', { hidden: true });
    await setWithTrophies(hidden.id);
    await expect(setHuntGame(t.db, TEST_USER, hidden.id)).rejects.toBeInstanceOf(NotFoundError);

    const other = await game('Other', { userId: TEST_USER_2 });
    await setWithTrophies(other.id, { userId: TEST_USER_2 });
    await expect(setHuntGame(t.db, TEST_USER, other.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getHunts(t.db, TEST_USER_2)).game).toBeNull();

    const done = await game('Done');
    await setWithTrophies(done.id, { platEarned: true });
    await expect(setHuntGame(t.db, TEST_USER, done.id)).rejects.toBeInstanceOf(HuntConflictError);

    const cleared = await setHuntGame(t.db, TEST_USER, null);
    expect(cleared.game).toBeNull();
  });

  it('закрепляет трофей, лимит 5, полученный нельзя, снятие работает', async () => {
    const g = await game();
    const s = await setWithTrophies(g.id, { extraUnearned: 6 });
    const first = await setHuntTrophy(t.db, TEST_USER, g.id, s.id, 1, true);
    expect(first.trophies).toEqual([expect.objectContaining({ gameId: g.id, setId: s.id, trophyId: 1, name: 'T1', earned: false })]);

    for (let i = 2; i <= 5; i++) await setHuntTrophy(t.db, TEST_USER, g.id, s.id, i, true);
    await expect(setHuntTrophy(t.db, TEST_USER, g.id, s.id, 6, true)).rejects.toBeInstanceOf(HuntLimitError);
    expect((await getHunts(t.db, TEST_USER)).trophies).toHaveLength(HUNT_TROPHY_LIMIT);

    await setHuntTrophy(t.db, TEST_USER, g.id, s.id, 1, false);
    expect((await getHunts(t.db, TEST_USER)).trophies.map((x) => x.trophyId)).toEqual([2, 3, 4, 5]);

    await t.db.update(trophies).set({ earned: true, earnedAt: new Date() }).where(and(eq(trophies.trophySetId, s.id), eq(trophies.trophyId, 6)));
    await expect(setHuntTrophy(t.db, TEST_USER, g.id, s.id, 6, true)).rejects.toBeInstanceOf(HuntConflictError);
  });

  it('полученный трофей и полученная платина снимаются при чтении; чужие строки не видны', async () => {
    const g = await game();
    const s = await setWithTrophies(g.id);
    await setHuntTrophy(t.db, TEST_USER, g.id, s.id, 1, true);
    await setHuntGame(t.db, TEST_USER, g.id);
    await t.db.update(trophies).set({ earned: true, earnedAt: new Date() }).where(eq(trophies.userId, TEST_USER));
    await t.db.update(trophySets).set({ earnedPlatinum: 1, earnedBronze: 2 }).where(eq(trophySets.userId, TEST_USER));
    const v = await getHunts(t.db, TEST_USER);
    expect(v.game).toBeNull();
    expect(v.trophies).toEqual([]);
    expect(await t.db.select().from(huntTrophies)).toHaveLength(0);
    expect(await t.db.select().from(huntGames)).toHaveLength(0);

    const o = await game('B', { userId: TEST_USER_2 });
    const os = await setWithTrophies(o.id, { userId: TEST_USER_2 });
    await setHuntGame(t.db, TEST_USER_2, o.id);
    await setHuntTrophy(t.db, TEST_USER_2, o.id, os.id, 1, true);
    expect((await getHunts(t.db, TEST_USER)).game).toBeNull();
    expect((await getHunts(t.db, TEST_USER)).trophies).toEqual([]);
    expect((await getHunts(t.db, TEST_USER_2)).game?.id).toBe(o.id);
  });
});
