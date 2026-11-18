// /api/roadmap/calendar (сессия) и /api/cal/<ключ>.ics (без сессии): выпуск, лента с no-store/noindex, 404 на чужой ключ, отключение, 503 без утечки.
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

import { DELETE, GET, POST } from './route';
import { GET as FEED } from '../../cal/[token]/route';

const feed = (token: string) => FEED(new Request(`http://x/api/cal/${token}`), { params: Promise.resolve({ token }) });

describe('маршруты подписки на календарь', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); holder.db = t.db; resetTestSession(); });

  it('401 без сессии у управления', async () => {
    testSession.anonymous = true;
    expect((await GET(new Request('http://x'))).status).toBe(401);
    expect((await POST(new Request('http://x', { method: 'POST' }))).status).toBe(401);
  });

  it('выпуск, лента, отключение', async () => {
    const res = await POST(new Request('http://x/api/roadmap/calendar', { method: 'POST' }));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const { data } = await res.json();
    expect(data.path).toMatch(/^\/api\/cal\/[A-Za-z0-9_-]{43}\.ics$/);
    const token = data.path.split('/').pop() as string;
    const f = await feed(token);
    expect(f.status).toBe(200);
    expect(f.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(f.headers.get('cache-control')).toBe('private, no-store');
    expect(f.headers.get('x-robots-tag')).toContain('noindex');
    expect(await f.text()).toContain('BEGIN:VCALENDAR');
    expect((await (await GET(new Request('http://x'))).json()).data.active).toBe(true);
    expect((await DELETE(new Request('http://x', { method: 'DELETE' }))).status).toBe(200);
    const gone = await feed(token);
    expect(gone.status).toBe(404);
    expect(gone.headers.get('x-robots-tag')).toContain('noindex');
    expect((await feed('nope.ics')).status).toBe(404);
  });

  it('503 без утечки', async () => {
    holder.db = null;
    const r = await feed(`${'a'.repeat(43)}.ics`);
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain('SECRETPASS');
  });
});
