// П12.3: уровень из профиля, очки из счётчиков, прирост по датам трофеев (включая скрытые игры), прогноз, изоляция, нет профиля.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { pointsToReach } from './level';
import { getLevel } from './level-query';

const { psnProfile, trophySets, trophies } = schema;
const NOW = new Date('2026-11-16T21:00:00Z');
const U = asUserId(1);

describe('getLevel', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.pg.execute(sql`insert into allowed_users (email, role, status) values ('m@example.com', 'member', 'active')`);
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  let tid = 0;
  async function earned(type: 'platinum' | 'gold' | 'silver' | 'bronze', daysAgo: number | null, user = 1) {
    const [s] = await t.db.insert(trophySets).values({ userId: user, npCommunicationId: `NPWR${++tid}`, npServiceName: 'trophy2', name: 'S' }).returning();
    await t.db.insert(trophies).values({ userId: user, trophySetId: s.id, trophyId: tid, type, earned: true, earnedAt: daysAgo === null ? null : new Date(NOW.getTime() - daysAgo * 86_400_000) });
  }

  it('нет профиля или уровня — пусто', async () => {
    expect((await getLevel(t.db, U, NOW)).level).toBeNull();
    await t.db.insert(psnProfile).values({ userId: 1, onlineId: 'Nick' });
    expect(await getLevel(t.db, U, NOW)).toMatchObject({ level: null, gained: null });
  });

  it('счётчики сходятся с уровнем: очки, остаток, прирост за 30/365, прогноз', async () => {
    // 100 платин + 400 бронз = 30000 + 6000 = 36000 очков: уровень 246 (14940 + 46*450 = 35640), остаток 450 − 360 = 90
    await t.db.insert(psnProfile).values({ userId: 1, onlineId: 'Nick', trophyLevel: 246, trophyProgress: 80, trophyTier: 3, earnedPlatinum: 100, earnedGold: 0, earnedSilver: 0, earnedBronze: 400 });
    await earned('platinum', 10); // 300 за 30 дней
    await earned('gold', 100); // 90 за год (и за 90 дней ещё нет: 100 > 90)
    await earned('bronze', 400); // старше года
    await earned('bronze', null); // без даты
    await earned('platinum', 5, 2); // чужой
    const r = await getLevel(t.db, U, NOW);
    expect(r).toMatchObject({ level: 246, progress: 80, tier: 3, points: 36000, toNext: 90, approximate: false });
    expect(r.gained).toEqual({ d30: { points: 300, levels: 0 }, d365: { points: 390, levels: 1 } });
    // темп 300 очков / 90 дней: 90 очков ≈ 27 дней; до 300 уровня (59940) — дольше 5 лет
    expect(r.eta).toEqual({ next: '2026-12-14', milestone: { level: 300, date: null } });
    expect(pointsToReach(247) - 36000).toBe(90);
  });

  it('не сходится — approximate, остаток из процента PSN; без темпа прогноза нет', async () => {
    await t.db.insert(psnProfile).values({ userId: 1, onlineId: 'Nick', trophyLevel: 400, trophyProgress: 50, earnedPlatinum: 1, earnedGold: 0, earnedSilver: 0, earnedBronze: 0 });
    const r = await getLevel(t.db, U, NOW);
    expect(r).toMatchObject({ level: 400, approximate: true, toNext: 675, eta: null });
  });

  it('без счётчиков — только уровень', async () => {
    await t.db.insert(psnProfile).values({ userId: 1, onlineId: 'Nick', trophyLevel: 12, trophyProgress: 25 });
    expect(await getLevel(t.db, U, NOW)).toMatchObject({ level: 12, points: null, toNext: 45, gained: null, approximate: true });
  });
});
