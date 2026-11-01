// Подсказки статусов на PGlite (контракт 28): дубли PS4+PS5, DLC-платина, перепрохождение, отказы, изоляция user_id, роуты.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from './test-helpers';
import { planDuplicates } from './duplicates';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('no db');
    return holder.db;
  },
}));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

import { GET as listGet } from '@/app/api/status-hints/route';
import { GET as countGet } from '@/app/api/status-hints/count/route';
import { POST as dismissPost } from '@/app/api/status-hints/dismissals/route';
import { DELETE as dismissDelete } from '@/app/api/status-hints/dismissals/[gameId]/[rule]/route';
import { computeStatusHints, countStatusHints, dismissHint, getStatusHints, HintNotFoundError } from './status-hints-db';

const { games, gameStatus, trophies, trophySets, gameTrophySets, statusHintDismissals } = schema;
const A = TEST_USER;
const B = TEST_USER_2;
const NOW = new Date('2026-11-01T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('подсказки статусов (БД)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    holder.db = t.db;
    await t.db.execute(sql.raw(`insert into allowed_users (email, role, status) values ('b@example.com', 'member', 'active')`));
    // изоляция: у второго пользователя те же title_id, поэтому глобальные уникальные индексы не мешают (после 0015 они составные)
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    resetTestSession();
  });

  async function game(userId: typeof A, titleId: string, extra: Partial<typeof games.$inferInsert> = {}) {
    const [g] = await t.db
      .insert(games)
      .values({ userId, titleId, name: titleId, category: 'ps5_native_game', lastSeenAt: NOW, playDurationSeconds: 7200, ...extra })
      .returning({ id: games.id });
    return g.id;
  }
  const status = (userId: typeof A, gameId: number, st: 'playing' | 'completed' | 'dropped' | 'backlog' | 'shelved', changedDaysAgo: number) =>
    t.db.insert(gameStatus).values({ userId, gameId, status: st, statusChangedAt: daysAgo(changedDaysAgo), droppedAt: st === 'dropped' ? daysAgo(changedDaysAgo) : null, completedAt: st === 'completed' ? daysAgo(changedDaysAgo) : null });
  async function plat(userId: typeof A, gameId: number, np: string, o: { defined: number; earned: boolean; at?: Date }) {
    const [s] = await t.db.insert(trophySets).values({ userId, npCommunicationId: np, npServiceName: 'trophy2', name: np, definedBronze: o.defined - 1, definedPlatinum: 1, earnedPlatinum: o.earned ? 1 : 0 }).returning({ id: trophySets.id });
    await t.db.insert(gameTrophySets).values({ userId, gameId, trophySetId: s.id, source: 'title_id' });
    await t.db.insert(trophies).values({ userId, trophySetId: s.id, trophyId: 0, type: 'platinum', earned: o.earned, earnedAt: o.earned ? (o.at ?? daysAgo(3)) : null });
    return s.id;
  }
  const rules = async (u: typeof A) => (await computeStatusHints(t.db, u, NOW)).map((h) => `${h.gameId}:${h.rule}`);

  it('четыре правила на одной выборке', async () => {
    const g1 = await game(A, 'G1', { lastPlayedAt: daysAgo(2) });
    await status(A, g1, 'backlog', 30);
    const g2 = await game(A, 'G2', { lastPlayedAt: daysAgo(50) });
    await status(A, g2, 'playing', 80);
    const g3 = await game(A, 'G3', { lastPlayedAt: daysAgo(100) });
    await plat(A, g3, 'NP3', { defined: 40, earned: true });
    const g4 = await game(A, 'G4', { lastPlayedAt: daysAgo(1) });
    await status(A, g4, 'dropped', 60);
    expect(await rules(A)).toEqual([`${g3}:platinum`, `${g4}:returned`, `${g1}:started`, `${g2}:stale`]);
    expect(await countStatusHints(t.db, A, NOW)).toBe(4);
  });

  it('PS4 + PS5 (дубли): одна подсказка на главную, часы и запуски группы суммируются', async () => {
    const ps4 = await game(A, 'CUSA', { name: 'Game', category: 'ps4_game', conceptId: 'c1', playDurationSeconds: 600, lastPlayedAt: daysAgo(100) });
    const ps5 = await game(A, 'PPSA', { name: 'Game', conceptId: 'c1', playDurationSeconds: 100, lastPlayedAt: daysAgo(1) });
    // главная = больше часов (PS4); дубль PS5 запускался недавно
    const plan = planDuplicates([
      { id: ps4, conceptId: 'c1', name: 'Game', category: 'ps4_game', playSeconds: 600, hidden: false, notDuplicate: false, duplicateOf: null },
      { id: ps5, conceptId: 'c1', name: 'Game', category: 'ps5_native_game', playSeconds: 100, hidden: false, notDuplicate: false, duplicateOf: null },
    ]);
    expect(plan.get(ps5)).toBe(ps4);
    await t.db.update(games).set({ duplicateOfGameId: ps4 }).where(sql`id = ${ps5}`);
    // платина только в PS5-версии
    await plat(A, ps5, 'NP5', { defined: 50, earned: true, at: daysAgo(1) });
    await plat(A, ps4, 'NP4', { defined: 50, earned: false });
    await status(A, ps4, 'backlog', 40);
    const hints = await computeStatusHints(t.db, A, NOW);
    expect(hints.map((h) => [h.gameId, h.rule])).toEqual([[ps4, 'platinum']]);
    const { items } = await getStatusHints(t.db, A, NOW);
    expect(items).toHaveLength(1);
    expect(items[0].game.id).toBe(ps4);
    // отказ, записанный по дублю, действует на главную
    await dismissHint(t.db, A, ps5, 'platinum');
    expect((await computeStatusHints(t.db, A, NOW)).map((h) => h.rule)).toEqual(['started']); // запуск PS5 после смены статуса
  });

  it('скрытая игра и её дубль подсказок не дают', async () => {
    const g = await game(A, 'H', { lastPlayedAt: daysAgo(1), hiddenAt: daysAgo(1) });
    expect(g).toBeGreaterThan(0);
    expect(await rules(A)).toEqual([]);
  });

  it('DLC-платина: отдельный сет-дополнение с платиной не даёт «Пройдено?»', async () => {
    const g = await game(A, 'D', { lastPlayedAt: daysAgo(40) });
    await status(A, g, 'playing', 50);
    await plat(A, g, 'BASE', { defined: 60, earned: false });
    await plat(A, g, 'DLC', { defined: 12, earned: true });
    expect(await rules(A)).toEqual([`${g}:stale`]);
  });

  it('перепрохождение: платина давно, «Играю» поставлен позже: подсказки нет', async () => {
    const g = await game(A, 'R', { lastPlayedAt: daysAgo(1) });
    await plat(A, g, 'NPR', { defined: 40, earned: true, at: daysAgo(400) });
    await status(A, g, 'playing', 5);
    expect(await rules(A)).toEqual([]);
  });

  it('отказ: по правилу, идемпотентен, отмена возвращает подсказку', async () => {
    const g = await game(A, 'X', { lastPlayedAt: daysAgo(2) });
    await status(A, g, 'backlog', 20);
    await dismissHint(t.db, A, g, 'started');
    await dismissHint(t.db, A, g, 'started');
    expect((await t.db.select().from(statusHintDismissals)).length).toBe(1);
    expect(await rules(A)).toEqual([]);
  });

  it('изоляция: игры, статусы, трофеи и отказы пользователя B не влияют на A', async () => {
    const a = await game(A, 'SAME', { lastPlayedAt: daysAgo(2) });
    const b = await game(B, 'SAME', { lastPlayedAt: daysAgo(2) });
    await status(A, a, 'backlog', 20);
    await status(B, b, 'backlog', 20);
    await plat(B, b, 'NPB', { defined: 30, earned: true });
    await dismissHint(t.db, B, b, 'started');
    expect(await rules(A)).toEqual([`${a}:started`]);
    expect(await rules(B)).toEqual([`${b}:platinum`]);
    await dismissHint(t.db, B, b, 'platinum');
    expect(await rules(B)).toEqual([]);
    expect(await rules(A)).toEqual([`${a}:started`]);
    // чужая игра: отказ невозможен
    await expect(dismissHint(t.db, A, b, 'started')).rejects.toBeInstanceOf(HintNotFoundError);
    expect(await countStatusHints(t.db, A, NOW)).toBe(1);
    const gamesOfA = (await getStatusHints(t.db, A, NOW)).items.map((i) => i.game.id);
    expect(gamesOfA).toEqual([a]);
  });

  describe('роуты', () => {
    const json = { 'content-type': 'application/json' };
    const post = (body: unknown, headers: Record<string, string> = json) =>
      dismissPost(new Request('http://x/api/status-hints/dismissals', { method: 'POST', headers, body: JSON.stringify(body) }));
    const del = (gameId: string, rule: string, headers: Record<string, string> = {}) =>
      dismissDelete(new Request('http://x/x', { method: 'DELETE', headers }), { params: Promise.resolve({ gameId, rule }) });

    it('GET: список и счётчик в конверте; без сессии 401', async () => {
      // «Играю?» и «Пройдено?» приходят с датами «сейчас», поэтому проверяем форму, а не набор
      const g = await game(A, 'Z', { lastPlayedAt: new Date() });
      const r = await listGet(new Request('http://x/api/status-hints'));
      const body = await r.json();
      expect(body.ok).toBe(true);
      expect(body.data.count).toBe(1);
      expect(body.data.items[0]).toMatchObject({ gameId: g, rule: 'started', question: 'Играю?', suggested: ['playing'], currentStatus: null });
      expect(body.data.items[0].game.id).toBe(g);
      expect((await (await countGet(new Request('http://x/c'))).json()).data).toEqual({ count: 1 });
      testSession.anonymous = true;
      expect((await listGet(new Request('http://x/api/status-hints'))).status).toBe(401);
      expect((await countGet(new Request('http://x/c'))).status).toBe(401);
      expect((await post({ gameId: g, rule: 'started' })).status).toBe(401);
    });

    it('POST/DELETE: валидация, 404 для чужой, идемпотентность', async () => {
      const g = await game(A, 'Q', { lastPlayedAt: new Date() });
      const other = await game(B, 'Q', { lastPlayedAt: new Date() });
      for (const bad of [{}, { gameId: g }, { gameId: g, rule: 'x' }, { gameId: '1', rule: 'started' }, { gameId: g, rule: 'started', extra: 1 }, []])
        expect((await post(bad)).status, JSON.stringify(bad)).toBe(400);
      expect((await post({ gameId: g, rule: 'started' }, { 'content-type': 'text/plain' })).status).toBe(400);
      expect((await post({ gameId: g, rule: 'started' }, { ...json, origin: 'http://evil.example', host: 'x' })).status).toBe(400);
      const foreign = await post({ gameId: other, rule: 'started' });
      expect(foreign.status).toBe(404);
      expect((await foreign.json()).error.code).toBe('not_found');
      expect((await post({ gameId: 999999, rule: 'started' })).status).toBe(404);
      expect((await post({ gameId: g, rule: 'started' })).status).toBe(200);
      expect((await post({ gameId: g, rule: 'started' })).status).toBe(200);
      expect((await (await countGet(new Request('http://x/c'))).json()).data.count).toBe(0);
      expect((await del('abc', 'started')).status).toBe(400);
      expect((await del(String(g), 'nope')).status).toBe(400);
      expect((await del(String(g), 'started', { origin: 'http://evil.example', host: 'x' })).status).toBe(400);
      // B не может снять отказ A и наоборот
      testSession.userId = 2;
      expect((await del(String(g), 'started')).status).toBe(200);
      testSession.userId = 1;
      expect((await (await countGet(new Request('http://x/c'))).json()).data.count).toBe(0);
      expect((await del(String(g), 'started')).status).toBe(200);
      expect((await del(String(g), 'started')).status).toBe(200);
      expect((await (await countGet(new Request('http://x/c'))).json()).data.count).toBe(1);
    });
  });
});
