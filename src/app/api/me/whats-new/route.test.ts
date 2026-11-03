// GET/PUT /api/me/whats-new (P2-16, контракт 23.5): только растёт, валидация, изоляция пользователей.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';

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
const get = () => GET(new Request('http://x/api/me/whats-new'));
const put = (body: unknown, headers: Record<string, string> = {}) =>
  PUT(new Request('http://x/api/me/whats-new', { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const seenOf = async (id: number) => (await t.db.select().from(allowedUsers).where(eq(allowedUsers.id, id)))[0].whatsNewSeen;
const as = (userId: number) => { testSession.userId = userId; testSession.role = 'member'; };

beforeAll(async () => {
  t = await createTestDb();
  holder.db = t.db;
  await t.db.insert(allowedUsers).values([
    { email: 'a@example.com', role: 'member', status: 'active' },
    { email: 'b@example.com', role: 'member', status: 'active' },
  ]);
});
afterAll(async () => { holder.db = null; await t.close(); });
beforeEach(async () => {
  resetTestSession();
  await t.db.update(allowedUsers).set({ whatsNewSeen: null });
});

describe('/api/me/whats-new', () => {
  it('новый пользователь: seen = null; PUT сохраняет, GET читает', async () => {
    as(A);
    expect((await (await get()).json()).data).toEqual({ seen: null });
    const r = await put({ seen: 12 });
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual({ seen: 12 });
    expect((await (await get()).json()).data).toEqual({ seen: 12 });
  });

  it('только растёт: меньшее значение не понижает, 0 с нуля сохраняется', async () => {
    as(A);
    expect((await (await put({ seen: 0 })).json()).data.seen).toBe(0);
    await put({ seen: 14 });
    expect((await (await put({ seen: 3 })).json()).data.seen).toBe(14);
    expect(await seenOf(A)).toBe(14);
  });

  it.each([[{}], [{ seen: -1 }], [{ seen: 1.5 }], [{ seen: '3' }], [{ seen: 100_001 }], [[]], ['not json']])('невалидное тело %j: 400', async (body) => {
    as(A);
    const r = await put(body);
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('invalid_request');
    expect(await seenOf(A)).toBeNull();
  });

  it('не application/json и чужой Origin: 400; без сессии 401', async () => {
    as(A);
    expect((await put({ seen: 1 }, { 'content-type': 'text/plain' })).status).toBe(400);
    expect((await put({ seen: 1 }, { origin: 'http://evil.example', host: 'x' })).status).toBe(400);
    testSession.anonymous = true;
    expect((await get()).status).toBe(401);
    expect((await put({ seen: 1 })).status).toBe(401);
  });

  it('изоляция: A не меняет B, userId из тела игнорируется', async () => {
    as(A);
    await put({ seen: 9, userId: B });
    expect(await seenOf(A)).toBe(9);
    expect(await seenOf(B)).toBeNull();
  });
});
