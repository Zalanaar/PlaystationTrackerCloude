// Фаза 32 (QA): /api/roadmap/goal на PGlite: закрытый доступ, 409, изоляция пользователей, отсутствие утечек полей.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';

let t: TestDb;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => t.db }));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);
const { DELETE, GET, PUT } = await import('./route');
const { allowedUsers, roadmapSettings, games, gameStatus } = schema;

const json = { 'content-type': 'application/json' };
const put = (body: unknown) => PUT(new Request('http://x/api/roadmap/goal', { method: 'PUT', headers: json, body: JSON.stringify(body) }));
const get = () => GET(new Request('http://x/api/roadmap/goal'));
const del = () => DELETE(new Request('http://x/api/roadmap/goal', { method: 'DELETE' }));
const goalOf = async (r: Response) => (await r.json()).data.goal;

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  resetTestSession();
  await t.db.insert(allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' }).onConflictDoNothing();
});

describe('QA-32: /api/roadmap/goal', () => {
  it('без сессии: 401 на GET, PUT и DELETE, данных нет', async () => {
    await t.db.insert(roadmapSettings).values({ userId: 1, year: 2026, hoursPerWeek: 5, goalMode: 'complete', goalCount: 5 });
    testSession.anonymous = true;
    for (const r of [await get(), await put({ mode: 'complete', count: 3 }), await del()]) {
      expect(r.status).toBe(401);
      expect(JSON.stringify(await r.json())).not.toContain('goal":{');
    }
    testSession.anonymous = false;
    expect((await t.db.select().from(roadmapSettings))[0].goalCount).toBe(5); // анонимный DELETE/PUT ничего не изменил
  });

  it('409 settings_required без строки настроек; строку PUT цели не создаёт', async () => {
    const r = await put({ mode: 'complete', count: 5 });
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('settings_required');
    expect(await t.db.select().from(roadmapSettings)).toHaveLength(0);
    expect(await goalOf(await get())).toBeNull();
  });

  it('PUT -> GET -> DELETE; DELETE без строки идемпотентен (200, goal null)', async () => {
    expect((await del()).status).toBe(200);
    await t.db.insert(roadmapSettings).values({ userId: 1, year: 2026, hoursPerWeek: 5 });
    const g = await goalOf(await put({ mode: 'backlog_to', count: 0 }));
    expect(g).toMatchObject({ mode: 'backlog_to', count: 0, target: 0, year: 2026 });
    expect(await goalOf(await get())).toMatchObject({ mode: 'backlog_to', count: 0 });
    expect(await goalOf(await del())).toBeNull();
    expect(await goalOf(await get())).toBeNull();
  });

  it('границы count в БД через API: 1000 ок, 1001 и 0 для complete отклонены, CHECK пары не нарушен', async () => {
    await t.db.insert(roadmapSettings).values({ userId: 1, year: 2026, hoursPerWeek: 5 });
    expect((await put({ mode: 'complete', count: 1000 })).status).toBe(200);
    expect((await put({ mode: 'complete', count: 1001 })).status).toBe(400);
    expect((await put({ mode: 'complete', count: 0 })).status).toBe(400);
    expect((await put({ mode: 'backlog_to', count: 1000 })).status).toBe(200);
    const [row] = await t.db.select().from(roadmapSettings);
    expect([row.goalMode, row.goalCount]).toEqual(['backlog_to', 1000]);
  });

  it('изоляция: пользователь 2 не видит, не меняет и не удаляет цель пользователя 1; тело ответа без чужих полей', async () => {
    await t.db.insert(roadmapSettings).values([{ userId: 1, year: 2026, hoursPerWeek: 5 }, { userId: 2, year: 2026, hoursPerWeek: 7 }]);
    await put({ mode: 'complete', count: 11 });
    testSession.userId = 2;
    expect(await goalOf(await get())).toBeNull();
    await del();
    expect(await goalOf(await put({ mode: 'backlog_to', count: 3 }))).toMatchObject({ mode: 'backlog_to', count: 3 });
    testSession.userId = 1;
    const mine = await goalOf(await get());
    expect(mine).toMatchObject({ mode: 'complete', count: 11 });
    expect(Object.keys(mine).sort()).toEqual(['asOf', 'count', 'current', 'diff', 'forecast', 'forecastAtYearEnd', 'mode', 'paceEmpty', 'pacePerMonth', 'remaining', 'requiredPerMonth', 'status', 'target', 'year']);
  });

  it('счётчики current считаются только по играм пользователя (чужой user_id в gameStatus не подмешивается)', async () => {
    await t.db.insert(roadmapSettings).values([{ userId: 1, year: 2026, hoursPerWeek: 5 }, { userId: 2, year: 2026, hoursPerWeek: 5 }]);
    const mk = async (u: number, id: string) => {
      const [g] = await t.db.insert(games).values({ userId: u, titleId: id, name: id, category: 'ps5_native_game', lastSeenAt: new Date() }).returning({ id: games.id });
      await t.db.insert(gameStatus).values({ userId: u, gameId: g.id, status: 'backlog' });
    };
    for (const id of ['a1', 'a2']) await mk(1, id);
    for (const id of ['b1', 'b2', 'b3']) await mk(2, id);
    expect((await goalOf(await put({ mode: 'backlog_to', count: 1 }))).current).toBe(2);
    testSession.userId = 2;
    expect((await goalOf(await put({ mode: 'backlog_to', count: 1 }))).current).toBe(3);
  });
});
