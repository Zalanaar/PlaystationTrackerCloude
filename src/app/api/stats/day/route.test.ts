// П11.1: GET /api/stats/day — 401, 400 на плохую дату, ответ, 503 без утечки строки подключения.
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

const get = (q: string) => GET(new Request(`http://x/api/stats/day${q}`));

describe('маршрут /api/stats/day', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); holder.db = t.db; resetTestSession(); });

  it('401 без сессии', async () => {
    testSession.anonymous = true;
    expect((await get('?date=2026-11-03')).status).toBe(401);
  });
  it('400 на плохую дату', async () => {
    for (const q of ['', '?date=', '?date=2026-02-30', '?date=03.11.2026']) expect((await get(q)).status).toBe(400);
  });
  it('пустой день', async () => {
    const r = await (await get('?date=2026-11-03')).json();
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ date: '2026-11-03', known: false, minutes: 0, games: [], finished: [], prev: null, next: null });
    expect(r.data.trophies.counts.total).toBe(0);
  });
  it('503 без утечки', async () => {
    holder.db = null;
    const res = await get('?date=2026-11-03');
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('SECRETPASS');
  });
});
