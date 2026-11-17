// П13.1: GET /api/stats/achievements — 401, 12 вех на пустой базе, 503 без утечки строки подключения.
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

const get = () => GET(new Request('http://x/api/stats/achievements'));

describe('маршрут /api/stats/achievements', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); holder.db = t.db; resetTestSession(); });

  it('401 без сессии', async () => {
    testSession.anonymous = true;
    expect((await get()).status).toBe(401);
  });
  it('пустая база', async () => {
    const r = await (await get()).json();
    expect(r.ok).toBe(true);
    expect(r.data.total).toBe(12);
    expect(r.data.unlocked).toBe(0);
  });
  it('503 без утечки', async () => {
    holder.db = null;
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('SECRETPASS');
  });
});
