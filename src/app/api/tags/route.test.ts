// П13.2: маршруты тегов — 401, 400 (имя, Origin, тело), 409 tag_exists, 404 чужое, набор тегов игры, 503 без утечки.
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

import { GET, POST } from './route';
import { DELETE, PATCH } from './[id]/route';
import { GET as GET_GAME, PUT as PUT_GAME } from '../games/[id]/tags/route';

const J = { 'content-type': 'application/json' };
const req = (url: string, method: string, body?: unknown, headers: Record<string, string> = J) =>
  new Request(`http://x${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

describe('маршруты /api/tags и /api/games/[id]/tags', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); holder.db = t.db; resetTestSession(); });

  it('401 без сессии', async () => {
    testSession.anonymous = true;
    expect((await GET(req('/api/tags', 'GET'))).status).toBe(401);
    expect((await POST(req('/api/tags', 'POST', { name: 'A' }))).status).toBe(401);
  });

  it('создание, список, переименование, удаление', async () => {
    const r = await (await POST(req('/api/tags', 'POST', { name: '  Кооп ' }))).json();
    expect(r.data.tag).toMatchObject({ name: 'Кооп', count: 0 });
    const id = r.data.tag.id as number;
    expect((await POST(req('/api/tags', 'POST', { name: 'кооп' }))).status).toBe(409);
    expect((await POST(req('/api/tags', 'POST', { name: '' }))).status).toBe(400);
    expect((await POST(req('/api/tags', 'POST', { name: 'A' }, { ...J, origin: 'http://evil.example', host: 'x' }))).status).toBe(400);
    expect((await (await GET(req('/api/tags', 'GET'))).json()).data.items).toEqual([{ id, name: 'Кооп', count: 0 }]);
    expect((await PATCH(req(`/api/tags/${id}`, 'PATCH', { name: 'С другом' }), ctx(id))).status).toBe(200);
    expect((await PATCH(req('/api/tags/999', 'PATCH', { name: 'X' }), ctx(999))).status).toBe(404);
    expect((await DELETE(req(`/api/tags/${id}`, 'DELETE', undefined, { origin: 'http://evil.example', host: 'x' }), ctx(id))).status).toBe(400);
    expect((await DELETE(req(`/api/tags/${id}`, 'DELETE', undefined, {}), ctx(id))).status).toBe(200);
    expect((await DELETE(req(`/api/tags/${id}`, 'DELETE', undefined, {}), ctx(id))).status).toBe(404);
  });

  it('теги игры', async () => {
    const [g] = await t.db.insert(schema.games).values({ userId: TEST_USER, titleId: 'CUSA1_00', name: 'G', category: 'ps4_game', lastSeenAt: new Date() }).returning();
    const tag = (await (await POST(req('/api/tags', 'POST', { name: 'A' }))).json()).data.tag.id as number;
    expect((await (await GET_GAME(req(`/api/games/${g.id}/tags`, 'GET'), ctx(g.id))).json()).data.tagIds).toEqual([]);
    expect((await (await PUT_GAME(req(`/api/games/${g.id}/tags`, 'PUT', { tagIds: [tag] }), ctx(g.id))).json()).data.tagIds).toEqual([tag]);
    expect((await PUT_GAME(req(`/api/games/${g.id}/tags`, 'PUT', { tagIds: [tag + 100] }), ctx(g.id))).status).toBe(404);
    expect((await PUT_GAME(req(`/api/games/${g.id}/tags`, 'PUT', { tagIds: ['x'] }), ctx(g.id))).status).toBe(400);
    expect((await PUT_GAME(req('/api/games/999/tags', 'PUT', { tagIds: [] }), ctx(999))).status).toBe(404);
    expect((await GET_GAME(req('/api/games/abc/tags', 'GET'), ctx('abc'))).status).toBe(400);
  });

  it('503 без утечки', async () => {
    holder.db = null;
    const res = await GET(req('/api/tags', 'GET'));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('SECRETPASS');
  });
});
