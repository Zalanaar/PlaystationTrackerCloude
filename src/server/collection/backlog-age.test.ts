// П12.4: отсчёт возраста (первый запуск раньше перевода в бэклог — от запуска), только бэклог, скрытые и дубли не считаются,
// медиана, «дольше года», самая давняя, изоляция пользователей.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { getBacklogAge, median } from './backlog-age';

const { games, gameStatus } = schema;
const NOW = new Date('2026-11-16T21:00:00Z');
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('median', () => {
  it('нечётное, чётное, пусто', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 10])).toBe(4);
    expect(median([])).toBeNull();
  });
});

describe('getBacklogAge (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.pg.execute(sql`insert into allowed_users (email, role, status) values ('m@example.com', 'member', 'active')`);
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  let n = 0;
  async function game(name: string, status: 'backlog' | 'playing', changedDaysAgo: number, o: { played?: number; hidden?: boolean; user?: number; secs?: number } = {}) {
    n += 1;
    const userId = o.user ?? TEST_USER;
    const [g] = await t.db.insert(games).values({
      userId, titleId: `CUSA${n}_00`, name, category: 'ps4_game', lastSeenAt: NOW,
      firstPlayedAt: o.played === undefined ? null : ago(o.played), hiddenAt: o.hidden ? NOW : null, playDurationSeconds: o.secs ?? 0,
    }).returning();
    await t.db.insert(gameStatus).values({ userId, gameId: g.id, status, statusChangedAt: ago(changedDaysAgo) });
    return g.id;
  }

  it('отсчёт, сводка, фильтры', async () => {
    const a = await game('Alpha', 'backlog', 30); // от перевода: 30 дней
    const b = await game('Beta', 'backlog', 30, { played: 800 }); // запуск раньше: 800 дней
    const c = await game('Gamma', 'backlog', 400, { played: 10 }); // запуск позже перевода: 400 дней
    await game('Playing', 'playing', 900);
    await game('Hidden', 'backlog', 2000, { hidden: true });
    await game('Other', 'backlog', 3000, { user: TEST_USER_2 });
    const r = await getBacklogAge(t.db, asUserId(TEST_USER), NOW);
    expect(r.items).toEqual([
      { gameId: a, since: ago(30).toISOString(), source: 'status', playSeconds: 0 },
      { gameId: b, since: ago(800).toISOString(), source: 'played', playSeconds: 0 },
      { gameId: c, since: ago(400).toISOString(), source: 'status', playSeconds: 0 },
    ]);
    expect(r.summary).toEqual({ count: 3, medianDays: 400, overYear: 2, cleanup: 1, oldest: { gameId: b, title: 'Beta', since: ago(800).toISOString() } });
  });

  it('идея 5: «Чистка» — не меньше 2 лет и меньше часа наиграно', async () => {
    await game('Old short', 'backlog', 731, { secs: 3599 });
    await game('Old played', 'backlog', 900, { secs: 3600 });
    await game('Young', 'backlog', 729, { secs: 0 });
    const r = await getBacklogAge(t.db, asUserId(TEST_USER), NOW);
    expect(r.summary.cleanup).toBe(1);
    expect(r.items.map((i) => i.playSeconds).sort()).toEqual([0, 3599, 3600]);
  });

  it('пусто', async () => {
    expect((await getBacklogAge(t.db, asUserId(TEST_USER), NOW)).summary).toEqual({ count: 0, medianDays: null, overYear: 0, cleanup: 0, oldest: null });
  });
});
