// П14.3: /api/me/showcase (сессия) и /api/showcase/<ключ> (без сессии): открыть, данные с no-store/noindex, закрыть → 404, 503 без утечки.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => { if (!holder.db) throw new Error('postgres://u:SECRETPASS@h/db'); return holder.db; },
}));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

import { DELETE, GET, POST } from './route';
import { GET as PUBLIC } from '../../showcase/[token]/route';

const pub = (token: string) => PUBLIC(new Request(`http://x/api/showcase/${token}`), { params: Promise.resolve({ token }) });

describe('маршруты витрины', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); holder.db = t.db; resetTestSession(); });

  it('401 без сессии у управления', async () => {
    testSession.anonymous = true;
    expect((await GET(new Request('http://x'))).status).toBe(401);
    expect((await POST(new Request('http://x', { method: 'POST' }))).status).toBe(401);
  });

  it('закрыта по умолчанию; открыть, публичные данные, закрыть', async () => {
    expect((await (await GET(new Request('http://x'))).json()).data).toEqual({ open: false, createdAt: null });
    const res = await POST(new Request('http://x/api/me/showcase', { method: 'POST' }));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const { data } = await res.json();
    expect(data.path).toMatch(/^\/s\/[A-Za-z0-9_-]{43}$/);
    const token = data.path.slice(3);
    const p = await pub(token);
    expect(p.status).toBe(200);
    expect(p.headers.get('cache-control')).toBe('private, no-store');
    expect(p.headers.get('x-robots-tag')).toContain('noindex');
    expect(p.headers.get('referrer-policy')).toBe('no-referrer');
    expect((await p.json()).data.values).toBeDefined();
    expect((await DELETE(new Request('http://x', { method: 'DELETE' }))).status).toBe(200);
    expect((await pub(token)).status).toBe(404);
  });

  it('503 без утечки', async () => {
    holder.db = null;
    const r = await pub('a'.repeat(43));
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain('SECRETPASS');
  });
});
