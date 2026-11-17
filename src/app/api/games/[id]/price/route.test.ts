// П13.3: /api/games/:id/price — 401, 400 на мусор, 404 чужая/нет, PUT и GET, null убирает цену; /api/stats/cost — сводка, 503 без утечки.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';

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
import { GET as COST } from '../../../stats/cost/route';

const ctx = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });
const put = (id: number | string, body: unknown) =>
  PUT(new Request(`http://x/api/games/${id}/price`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), ctx(id));

describe('маршруты цены', () => {
  let t: TestDb;
  let id = 0;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset(); holder.db = t.db; resetTestSession();
    const [g] = await t.db.insert(schema.games).values({ userId: TEST_USER, titleId: 'CUSA1_00', name: 'A', category: 'ps4_game', lastSeenAt: new Date(), playDurationSeconds: 20 * 3600 }).returning();
    id = g.id;
  });

  it('401 без сессии', async () => {
    testSession.anonymous = true;
    expect((await GET(new Request('http://x'), ctx(id))).status).toBe(401);
    expect((await COST(new Request('http://x/api/stats/cost'))).status).toBe(401);
  });
  it('400 и 404', async () => {
    expect((await put(id, { price: -5 })).status).toBe(400);
    expect((await put(id, { price: '100' })).status).toBe(400);
    expect((await put(id, {})).status).toBe(400);
    expect((await put('abc', { price: 1 })).status).toBe(400);
    expect((await put(id + 999, { price: 1 })).status).toBe(404);
  });
  it('PUT, GET, сводка, null убирает', async () => {
    expect((await (await put(id, { price: 2000 })).json()).data).toEqual({ price: 2000 });
    expect((await (await GET(new Request('http://x'), ctx(id))).json()).data).toEqual({ price: 2000 });
    const cost = (await (await COST(new Request('http://x/api/stats/cost'))).json()).data;
    expect(cost).toMatchObject({ priced: 1, total: 2000, hours: 20, perHour: 100 });
    expect((await (await put(id, { price: null })).json()).data).toEqual({ price: null });
    expect((await (await COST(new Request('http://x/api/stats/cost'))).json()).data.priced).toBe(0);
  });
  it('503 без утечки', async () => {
    holder.db = null;
    const res = await COST(new Request('http://x/api/stats/cost'));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('SECRETPASS');
  });
});
