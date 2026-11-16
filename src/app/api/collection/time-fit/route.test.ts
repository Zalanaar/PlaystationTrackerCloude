// П12.5: GET /api/collection/time-fit — 401, 400 на кривые минуты, по умолчанию 120, 503 без утечки строки подключения.
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

import { GET } from './route';

const get = (q = '') => GET(new Request(`http://x/api/collection/time-fit${q}`));

describe('маршрут /api/collection/time-fit', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); holder.db = t.db; resetTestSession(); });

  it('401 без сессии', async () => {
    testSession.anonymous = true;
    expect((await get()).status).toBe(401);
  });
  it('по умолчанию 120 минут, пусто', async () => {
    const r = await (await get()).json();
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ minutes: 120, finish: [], resume: [] });
  });
  it('minutes=60', async () => {
    expect((await (await get('?minutes=60')).json()).data.minutes).toBe(60);
  });
  it.each(['?minutes=abc', '?minutes=5', '?minutes=601', '?minutes=90.5'])('400 на %s', async (q) => {
    const res = await get(q);
    expect(res.status).toBe(400);
  });
  it('503 без утечки', async () => {
    holder.db = null;
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('SECRETPASS');
  });
});
