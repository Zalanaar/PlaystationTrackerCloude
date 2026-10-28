import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { setGameStatus } from '@/server/sync/status-rules';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { getWrapped } from '@/server/wrapped/query';
import { getGameDetails, toTrophyItem, type TrophyRow } from './details';
import { toPsnProfile, type ProfileRow } from './profile';
import { getCollectionSummary, getGamesByIds } from './query';

const { games, trophySets, gameTrophySets, trophies, psnProfile } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');

const profileRow = (o: Partial<ProfileRow> = {}): ProfileRow => ({
  id: 1, onlineId: 'Artem_PS', avatarUrl: 'https://a/xl.png', trophyLevel: 312, trophyProgress: 47, trophyTier: 7,
  earnedPlatinum: 38, earnedGold: 410, earnedSilver: 1100, earnedBronze: 2800, updatedAt: NOW, ...o,
});

describe('toPsnProfile (чистая)', () => {
  it('маппит поля и считает total', () => {
    expect(toPsnProfile(profileRow())).toEqual({
      onlineId: 'Artem_PS', avatarUrl: 'https://a/xl.png', level: 312, levelProgress: 47, tier: 7,
      trophies: { platinum: 38, gold: 410, silver: 1100, bronze: 2800, total: 4348 },
    });
  });
  it('нет счётчиков: trophies = null; пустые поля = null', () => {
    const p = toPsnProfile(profileRow({ earnedGold: null, avatarUrl: null, trophyLevel: null, trophyTier: null, trophyProgress: null }));
    expect(p).toEqual({ onlineId: 'Artem_PS', avatarUrl: null, level: null, levelProgress: null, tier: null, trophies: null });
  });
});

describe('toTrophyItem (чистая)', () => {
  const base: TrophyRow = {
    setId: 1, trophyId: 0, type: 'gold', name: 'Имя', detail: 'Описание', iconUrl: 'https://i', hidden: false, earned: true,
    earnedAt: new Date('2026-10-05T18:42:11Z'), rarity: 2, earnedRate: '2.40',
  };
  it('обычный трофей', () => {
    expect(toTrophyItem(base)).toMatchObject({ name: 'Имя', detail: 'Описание', earnedAt: '2026-10-05T18:42:11.000Z', earnedRate: 2.4, rarity: 2 });
  });
  it('скрытый не полученный: name/detail/iconUrl = null', () => {
    const t = toTrophyItem({ ...base, hidden: true, earned: false, earnedAt: null });
    expect(t).toMatchObject({ name: null, detail: null, hidden: true, earned: false, earnedAt: null, iconUrl: null });
  });
  it('скрытый полученный: значения как есть', () => {
    expect(toTrophyItem({ ...base, hidden: true })).toMatchObject({ name: 'Имя', detail: 'Описание', iconUrl: 'https://i' });
  });
  it('нет earnedRate/даты', () => {
    expect(toTrophyItem({ ...base, earnedRate: null, earnedAt: null })).toMatchObject({ earnedRate: null, earnedAt: null });
  });
});

describe('Фаза 9 на PGlite', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  let n = 0;
  const game = async (name: string, o: Partial<typeof games.$inferInsert> = {}) => {
    n += 1;
    const [g] = await t.db.insert(games).values({ titleId: `P9_${n}`, name, category: 'ps5_native_game', lastSeenAt: NOW, ...o }).returning();
    return g.id;
  };

  it('GameItem.bannerUrl', async () => {
    const a = await game('A', { bannerUrl: 'https://b/a.jpg' });
    const b = await game('B');
    const items = await getGamesByIds(t.db, [a, b]);
    expect(items.map((i) => i.bannerUrl)).toEqual(['https://b/a.jpg', null]);
  });

  it('summary.profile: null без синка, объект после', async () => {
    expect((await getCollectionSummary(t.db)).profile).toBeNull();
    await t.db.insert(psnProfile).values({ id: 1, onlineId: 'Artem_PS', trophyLevel: 5 });
    const s = await getCollectionSummary(t.db);
    expect(s.profile).toEqual({ onlineId: 'Artem_PS', avatarUrl: null, level: 5, levelProgress: null, tier: null, trophies: null });
  });

  it('wrapped.profile.avatarUrl из psn_profile; onlineId: env, иначе профиль', async () => {
    let w = await getWrapped(t.db, 2026, null, NOW);
    expect(w.profile).toEqual({ onlineId: null, avatarUrl: null });
    await t.db.insert(psnProfile).values({ id: 1, onlineId: 'Artem_PS', avatarUrl: 'https://a/xl.png' });
    w = await getWrapped(t.db, 2026, null, NOW);
    expect(w.profile).toEqual({ onlineId: 'Artem_PS', avatarUrl: 'https://a/xl.png' });
    w = await getWrapped(t.db, 2026, 'env_id', NOW);
    expect(w.profile.onlineId).toBe('env_id');
  });

  it('GET details: нет игры = null; игра без сетов', async () => {
    expect(await getGameDetails(t.db, 9999)).toBeNull();
    const a = await game('A', { firstPlayedAt: new Date('2024-03-01T10:00:00Z') });
    const d = await getGameDetails(t.db, a);
    expect(d).toMatchObject({ firstPlayedAt: '2024-03-01T10:00:00.000Z', statusChangedAt: null, trophyList: [] });
    expect(d?.game.id).toBe(a);
  });

  it('GET details: трофеи двух сетов в порядке setId, trophyId; маска скрытых; statusChangedAt; скрытая игра отдаётся', async () => {
    const a = await game('A');
    const [s1, s2] = await t.db
      .insert(trophySets)
      .values([
        { npCommunicationId: 'NPWR1', npServiceName: 'trophy', name: 's1', definedPlatinum: 1 },
        { npCommunicationId: 'NPWR2', npServiceName: 'trophy', name: 's2' },
      ])
      .returning();
    const other = await game('Other');
    await t.db.insert(gameTrophySets).values([
      { gameId: a, trophySetId: s2.id, source: 'title_id' },
      { gameId: a, trophySetId: s1.id, source: 'title_id' },
      { gameId: other, trophySetId: s2.id, source: 'title_id' },
    ]);
    await t.db.insert(trophies).values([
      { trophySetId: s2.id, trophyId: 0, type: 'bronze', name: 'B0' },
      { trophySetId: s1.id, trophyId: 1, type: 'gold', name: 'secret', detail: 'd', hidden: true },
      { trophySetId: s1.id, trophyId: 0, type: 'platinum', name: 'Plat', earned: true, earnedAt: new Date('2026-10-05T18:42:11Z'), rarity: 0, earnedRate: '2.40' },
    ]);
    await setGameStatus(t.db, a, 'backlog');
    await t.db.update(games).set({ hiddenAt: NOW }).where(eq(games.id, a));

    const d = await getGameDetails(t.db, a);
    expect(d?.trophyList.map((x) => [x.setId, x.trophyId])).toEqual([[s1.id, 0], [s1.id, 1], [s2.id, 0]]);
    expect(d?.trophyList[1]).toMatchObject({ name: null, detail: null, hidden: true });
    expect(d?.trophyList[0]).toMatchObject({ type: 'platinum', earned: true, rarity: 0, earnedRate: 2.4 });
    expect(d?.statusChangedAt).not.toBeNull();
    expect(d?.game.hiddenAt).not.toBeNull();
    expect(d?.game.status).toBe('backlog');
  });
});
