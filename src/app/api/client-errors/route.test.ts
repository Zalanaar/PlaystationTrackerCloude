// П10: журнал ошибок браузера — валидация, Origin, лимит в час, срок хранения, изоляция пользователей, чистка query/токенов, 503 без утечек.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { asUserId } from '@/server/auth/user-id';
import { CLIENT_ERRORS_PER_HOUR, cleanPath, parseClientError, recordClientError, scrub } from '@/server/client-errors/log';

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

const json = { 'content-type': 'application/json' };
const post = (body: unknown, headers: Record<string, string> = json) =>
  POST(new Request('http://x/api/client-errors', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const err = { kind: 'error', message: 'TypeError: x is undefined', path: '/stats?code=SECRET#h', source: '/_next/static/chunks/a.js?v=1:10:5', stack: 'at f (a.js:1:2)', ua: 'iPhone' };

describe('П10: чистые проверки', () => {
  it('путь без query и hash, только относительный', () => {
    expect(cleanPath('/stats?code=1#x')).toBe('/stats');
    expect(cleanPath('https://evil/x')).toBeNull();
    expect(cleanPath(5)).toBeNull();
  });
  it('длинные токены вычищаются', () => {
    expect(scrub(`npsso ${'a'.repeat(64)} end`)).toBe('npsso … end');
  });
  it('kind и message обязательны', () => {
    expect(parseClientError({ kind: 'warn', message: 'x' }).ok).toBe(false);
    expect(parseClientError({ kind: 'error', message: '  ' }).ok).toBe(false);
    expect(parseClientError(null).ok).toBe(false);
    const p = parseClientError(err);
    expect(p.ok && p.value).toMatchObject({ path: '/stats', source: '/_next/static/chunks/a.js' });
  });
});

describe('маршрут /api/client-errors', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insert(schema.allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.db.delete(schema.clientErrors);
    holder.db = t.db;
    resetTestSession();
  });

  it('401 без сессии', async () => {
    testSession.anonymous = true;
    expect((await GET(new Request('http://x/api/client-errors'))).status).toBe(401);
    expect((await post(err)).status).toBe(401);
  });

  it('чужой Origin и не-JSON → 400; плохое тело → 400', async () => {
    expect((await post(err, { ...json, origin: 'http://evil.example', host: 'x' })).status).toBe(400);
    expect((await post('x', { 'content-type': 'text/plain' })).status).toBe(400);
    expect((await post({ kind: 'nope', message: 'x' })).status).toBe(400);
  });

  it('запись и сводка: только свои, query отрезан', async () => {
    expect(await (await post(err)).json()).toEqual({ ok: true, data: { stored: true } });
    testSession.userId = 2; testSession.role = 'member';
    await post({ ...err, message: 'чужая' });
    let s = await (await GET(new Request('http://x/api/client-errors'))).json();
    expect(s.data.count).toBe(1);
    expect(s.data.recent[0].message).toBe('чужая');
    resetTestSession();
    s = await (await GET(new Request('http://x/api/client-errors'))).json();
    expect(s.data).toMatchObject({ days: 7, count: 1, recent: [{ kind: 'error', message: err.message, path: '/stats' }] });
  });

  it('лимит в час и срок хранения 30 дней', async () => {
    const u = asUserId(1);
    const p = parseClientError(err);
    if (!p.ok) throw new Error('x');
    const now = new Date('2026-11-16T12:00:00Z');
    await t.db.insert(schema.clientErrors).values({ userId: 1, kind: 'error', message: 'старая', createdAt: new Date('2026-10-01T00:00:00Z') });
    for (let i = 0; i < CLIENT_ERRORS_PER_HOUR; i++) expect(await recordClientError(t.db, u, p.value, now)).toBe(true);
    expect(await recordClientError(t.db, u, p.value, now)).toBe(false);
    const rows = await t.db.select().from(schema.clientErrors);
    expect(rows).toHaveLength(CLIENT_ERRORS_PER_HOUR);
    expect(rows.some((r) => r.message === 'старая')).toBe(false);
  });

  it('503 без утечки строки подключения', async () => {
    holder.db = null;
    const r = await post(err);
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain('SECRETPASS');
  });
});
