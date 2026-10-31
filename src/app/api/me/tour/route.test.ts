// GET/PUT /api/me/tour (контракт 23): состояние, автозапуск, идемпотентность, ошибки, изоляция пользователей.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { TOUR_VERSION } from '@/shared/tour';

const { allowedUsers } = schema;
const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('no db');
    return holder.db;
  },
}));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

const { GET, PUT } = await import('./route');

let t: TestDb;
const A = 2;
const B = 3;
const get = () => GET(new Request('http://x/api/me/tour'));
const put = (body: unknown, headers: Record<string, string> = {}) =>
  PUT(new Request('http://x/api/me/tour', { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const row = async (id: number) => (await t.db.select().from(allowedUsers).where(eq(allowedUsers.id, id)))[0];
const as = (userId: number, role: 'owner' | 'member') => {
  testSession.userId = userId;
  testSession.role = role;
};

beforeAll(async () => {
  t = await createTestDb();
  holder.db = t.db;
  await t.db.insert(allowedUsers).values([
    { email: 'a@example.com', role: 'member', status: 'active' },
    { email: 'b@example.com', role: 'member', status: 'active' },
  ]);
});
afterAll(async () => {
  holder.db = null;
  await t.close();
});
beforeEach(async () => {
  resetTestSession();
  await t.db.update(allowedUsers).set({ tourVersion: null, tourCompletedAt: null, onboardedAt: null });
});

describe('GET /api/me/tour', () => {
  it('member без онбординга: автозапуска нет', async () => {
    as(A, 'member');
    const r = await get();
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual({ version: TOUR_VERSION, completedVersion: 0, shouldAutoStart: false });
  });

  it('member после онбординга: автозапуск, после PUT нет', async () => {
    as(A, 'member');
    await t.db.update(allowedUsers).set({ onboardedAt: new Date() }).where(eq(allowedUsers.id, A));
    expect((await (await get()).json()).data.shouldAutoStart).toBe(true);
    const r = await put({ done: true, version: TOUR_VERSION });
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual({ version: TOUR_VERSION, completedVersion: TOUR_VERSION, shouldAutoStart: false });
    expect((await (await get()).json()).data.completedVersion).toBe(TOUR_VERSION);
  });

  it('owner без onboarded_at: автозапуск по роли', async () => {
    as(1, 'owner');
    expect((await (await get()).json()).data.shouldAutoStart).toBe(true);
  });

  it('без сессии 401', async () => {
    testSession.anonymous = true;
    expect((await get()).status).toBe(401);
    expect((await put({ done: true, version: 1 })).status).toBe(401);
  });
});

describe('PUT /api/me/tour', () => {
  it('идемпотентно: повтор не меняет tour_completed_at', async () => {
    as(A, 'member');
    expect((await put({ done: true, version: 1 })).status).toBe(200);
    const first = (await row(A)).tourCompletedAt;
    expect(first).not.toBeNull();
    expect((await put({ done: true, version: 1 })).status).toBe(200);
    expect((await row(A)).tourCompletedAt).toEqual(first);
    expect((await row(A)).tourVersion).toBe(1);
  });

  it('версию вниз не откатить', async () => {
    as(A, 'member');
    await t.db.update(allowedUsers).set({ tourVersion: 5 }).where(eq(allowedUsers.id, A));
    // версия выше TOUR_VERSION отклоняется, а меньшая не понижает
    expect((await put({ done: true, version: 1 })).status).toBe(200);
    expect((await row(A)).tourVersion).toBe(5);
  });

  it.each([
    [{ done: false, version: 1 }],
    [{ version: 1 }],
    [{ done: true }],
    [{ done: true, version: 0 }],
    [{ done: true, version: -1 }],
    [{ done: true, version: 1.5 }],
    [{ done: true, version: '1' }],
    [{ done: true, version: TOUR_VERSION + 1 }],
    [[]],
    ['not json'],
  ])('невалидное тело %j: 400, данные не меняются', async (body) => {
    as(A, 'member');
    const r = await put(body);
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('invalid_request');
    expect((await row(A)).tourVersion).toBeNull();
  });

  it('не application/json и чужой Origin: 400', async () => {
    as(A, 'member');
    expect((await put({ done: true, version: 1 }, { 'content-type': 'text/plain' })).status).toBe(400);
    expect((await put({ done: true, version: 1 }, { origin: 'http://evil.example', host: 'x' })).status).toBe(400);
    expect((await row(A)).tourVersion).toBeNull();
  });

  it('изоляция: A не меняет тур B, userId из тела игнорируется', async () => {
    as(A, 'member');
    await put({ done: true, version: 1, userId: B, id: B });
    expect((await row(A)).tourVersion).toBe(1);
    expect((await row(B)).tourVersion).toBeNull();
    expect((await row(B)).tourCompletedAt).toBeNull();
    as(B, 'member');
    expect((await (await get()).json()).data.completedVersion).toBe(0);
  });
});
