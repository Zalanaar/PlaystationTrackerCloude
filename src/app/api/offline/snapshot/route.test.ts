// Пакет 7, п. 2: GET /api/offline/snapshot — только с сессией, no-store, данные активного профиля.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';

vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);
let t: TestDb;
let broken = false;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => { if (broken) throw new Error('db down'); return t.db; } }));
const { GET } = await import('./route');
const req = () => new Request('http://x/api/offline/snapshot');

beforeAll(async () => { t = await createTestDb(); });
afterAll(() => t.close());
beforeEach(async () => { await t.reset(); });
afterEach(() => { resetTestSession(); broken = false; });

describe('GET /api/offline/snapshot', () => {
  it('без сессии 401', async () => {
    testSession.anonymous = true;
    expect((await GET(req())).status).toBe(401);
  });
  it('с сессией: 200, no-store, копия активного профиля', async () => {
    const r = await GET(req());
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const d = (await r.json()).data;
    expect(d).toMatchObject({ v: 1, profileId: 1, games: [], backlog: [] });
  });
  it('БД недоступна: 503', async () => {
    broken = true;
    expect((await GET(req())).status).toBe(503);
  });
});
