// Пакет 7, п. 2: копия для офлайн-просмотра — только активный профиль, видимые игры, бэклог в порядке экрана, статистика года.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { isOfflineSnapshot, OFFLINE_SNAPSHOT_VERSION } from '@/shared/offline-snapshot';
import { buildOfflineSnapshot } from './snapshot';

const { allowedUsers, games, gameStatus } = schema;

describe('buildOfflineSnapshot (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    const [u2] = await t.db.select({ id: allowedUsers.id }).from(allowedUsers).where(eq(allowedUsers.id, TEST_USER_2));
    if (!u2) await t.db.insert(allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' });
  });

  let n = 0;
  async function game(status: 'backlog' | 'playing' | 'completed' | null, extra: Partial<typeof games.$inferInsert> = {}, userId: number = TEST_USER) {
    n += 1;
    const [g] = await t.db.insert(games).values({ userId, titleId: `CUSA${n}_00`, name: `Игра ${n}`, category: 'ps4_game', lastSeenAt: new Date('2026-10-01T00:00:00Z'), ...extra }).returning();
    if (status) await t.db.insert(gameStatus).values({ userId, gameId: g.id, status });
    return g.id;
  }

  it('коллекция, бэклог, сводка и год; скрытые и чужие игры не попадают', async () => {
    const now = new Date('2026-11-16T09:00:00Z');
    const a = await game('backlog', { lastPlayedAt: new Date('2026-11-10T10:00:00Z'), playDurationSeconds: 7200 });
    const b = await game('backlog', { lastPlayedAt: new Date('2026-11-12T10:00:00Z') });
    const c = await game('playing', { lastPlayedAt: new Date('2026-11-15T10:00:00Z'), playDurationSeconds: 36000 });
    await game('completed', { hiddenAt: new Date('2026-11-01T00:00:00Z') });
    await game('backlog', {}, TEST_USER_2);

    const s = await buildOfflineSnapshot(t.db, asUserId(TEST_USER), now);
    expect(isOfflineSnapshot(s)).toBe(true);
    expect(s.v).toBe(OFFLINE_SNAPSHOT_VERSION);
    expect(s.generatedAt).toBe(now.toISOString());
    expect(s.profileId).toBe(TEST_USER);
    expect(s.games.map((g) => g.id)).toEqual([c, b, a]);
    expect(s.games.find((g) => g.id === c)).toMatchObject({ status: 'playing', hours: 10, title: expect.any(String) });
    expect(s.backlog).toEqual([b, a]);
    expect(s.counts).toMatchObject({ backlog: 2, playing: 1 });
    expect(s.totals.games).toBe(3);
    expect(s.stats.year).toBe(2026);
    expect(s.stats.hoursByMonth).toHaveLength(12);
    // в копии нет служебных полей: только то, что показывает экран
    expect(Object.keys(s.games[0]).sort()).toEqual(['completedAt', 'coverUrl', 'durationHours', 'hours', 'id', 'lastPlayedAt', 'platform', 'status', 'title', 'trophies']);
  });

  it('другой профиль получает только свои игры', async () => {
    await game('backlog');
    const mine = await game('backlog', {}, TEST_USER_2);
    const s = await buildOfflineSnapshot(t.db, asUserId(TEST_USER_2), new Date('2026-11-16T09:00:00Z'));
    expect(s.profileId).toBe(TEST_USER_2);
    expect(s.games.map((g) => g.id)).toEqual([mine]);
    expect(s.backlog).toEqual([mine]);
  });
});
