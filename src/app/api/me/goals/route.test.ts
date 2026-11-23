// GET/PUT /api/me/goals — 401, сохранение, 400, 503 без утечки строки подключения.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('postgres://user:SECRETPASS@host/db unreachable');
    return holder.db;
  },
}));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

import { GET, PUT } from './route';

const get = () => GET(new Request('http://x/api/me/goals'));
const put = (body: unknown) => PUT(new Request('http://x/api/me/goals', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

describe('маршрут целей месяца', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); holder.db = t.db; resetTestSession(); });

  it('401 без сессии', async () => {
    testSession.anonymous = true;
    expect((await get()).status).toBe(401);
    expect((await put({ games: 1 })).status).toBe(401);
  });
  it('чтение, сохранение, снятие', async () => {
    expect((await (await get()).json()).data.hasGoals).toBe(false);
    const saved = await (await put({ games: 3, hours: 20 })).json();
    expect(saved.data.hasGoals).toBe(true);
    expect(saved.data.goals).toEqual({ games: 3, hours: 20, trophies: null });
    expect((await (await put({ games: null, hours: null, trophies: null })).json()).data.hasGoals).toBe(false);
  });
  it('400 на некорректное тело', async () => {
    expect((await put({ games: 0 })).status).toBe(400);
    expect((await put({ foo: 1 })).status).toBe(400);
  });
  it('503 без утечки', async () => {
    holder.db = null;
    for (const res of [await get(), await put({ games: 1 })]) {
      expect(res.status).toBe(503);
      expect(await res.text()).not.toContain('SECRETPASS');
    }
  });
});
