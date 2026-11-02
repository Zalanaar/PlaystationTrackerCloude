// Фаза 48 (п. 11): одно число «бэклог» на всех экранах. countBacklog = counts.backlog коллекции = meta.backlog «Подскажи»
// = backlogTotal «Плана»; скрытые игры (в том числе PS PC) и дубли не считаются; «Не предлагать» и «Убрать из плана» не вычитаются.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { countBacklog } from './backlog';
import { getCollectionSummary, listGames } from './query';
import { getRecommendations } from '@/server/recommend/db';
import { getRoadmap } from '@/server/roadmap/db';
import { parseListQuery } from './validation';

const { games, gameStatus, recommendDislikes, roadmapExcluded } = schema;

describe('countBacklog: единое число бэклога (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); });

  let n = 0;
  async function game(status: 'backlog' | 'playing' | null, extra: Partial<typeof games.$inferInsert> = {}, userId: number = TEST_USER) {
    n += 1;
    const [g] = await t.db.insert(games).values({ userId, titleId: `CUSA${n}_00`, name: `Игра ${n}`, category: 'ps4_game', lastSeenAt: new Date('2026-10-01T00:00:00Z'), ...extra }).returning();
    if (status) await t.db.insert(gameStatus).values({ userId, gameId: g.id, status });
    return g.id;
  }

  it('совпадает на коллекции, /backlog, «Подскажи» и «Плане»', async () => {
    const uid = asUserId(TEST_USER);
    const a = await game('backlog');
    const b = await game('backlog');
    await game('backlog', { category: 'pspc_game' });
    await game('backlog', { category: 'pspc_game', hiddenAt: new Date() });
    await game('backlog', { duplicateOfGameId: a });
    await game('playing');
    await game(null);
    await t.db.insert(recommendDislikes).values({ userId: TEST_USER, gameId: a });
    await t.db.insert(roadmapExcluded).values({ userId: TEST_USER, gameId: b });

    const total = await countBacklog(t.db, uid);
    expect(total).toBe(3);
    expect((await getCollectionSummary(t.db, uid)).counts.backlog).toBe(total);
    const q = parseListQuery(new URLSearchParams('status=backlog&limit=1'));
    if (!q.ok) throw new Error('bad query');
    expect((await listGames(t.db, uid, q.value)).total).toBe(total);
    const rec = await getRecommendations(t.db, uid, 'any', new Date(), { llm: null });
    expect(rec.meta.backlog).toBe(total);
    expect(rec.meta.candidates).toBe(total - 1);
    const rm = await getRoadmap(t.db, uid);
    expect(rm.backlogTotal).toBe(total);
    expect(rm.unallocated.filter((u) => u.kind === 'backlog')).toHaveLength(1);
  });

  it('чужой user_id не считается; снятие скрытия возвращает игру в число', async () => {
    const uid = asUserId(TEST_USER);
    const h = await game('backlog', { hiddenAt: new Date() });
    await t.db.execute(sql.raw(`insert into allowed_users (email, role, status) values ('b@example.com', 'member', 'active')`));
    await game('backlog', {}, TEST_USER_2);
    expect(await countBacklog(t.db, uid)).toBe(0);
    await t.db.update(games).set({ hiddenAt: null }).where(eq(games.id, h));
    expect(await countBacklog(t.db, uid)).toBe(1);
  });
});
