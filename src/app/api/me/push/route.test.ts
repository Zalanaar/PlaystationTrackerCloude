// П14.2: /api/me/push и /api/me/push/test — состояние, подписка (белый список, ключи), 409 без VAPID, отписка, тест не чаще раза в минуту.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTestSession } from '@/server/auth/test-require-user';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => { if (!holder.db) throw new Error('postgres://u:SECRETPASS@h/db'); return holder.db; },
}));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);
const sent: string[] = [];
vi.mock('@/server/push/push', async (orig) => ({
  ...(await orig<typeof import('@/server/push/push')>()),
  webPushSender: async (s: { endpoint: string }) => { sent.push(s.endpoint); return 201; },
}));

import { DELETE, GET, POST } from './route';
import { POST as TEST } from './test/route';

const KEY = 'B'.repeat(87);
const SUB = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: KEY, auth: 'a'.repeat(22) } };
const req = (method: string, body?: unknown, h: Record<string, string> = {}) =>
  new Request('http://x/api/me/push', { method, headers: { 'content-type': 'application/json', host: 'x', ...h }, body: body === undefined ? undefined : JSON.stringify(body) });

describe('/api/me/push', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset(); holder.db = t.db; resetTestSession(); sent.length = 0;
    vi.stubEnv('VAPID_PUBLIC_KEY', KEY); vi.stubEnv('VAPID_PRIVATE_KEY', 'k'.repeat(43)); vi.stubEnv('VAPID_SUBJECT', 'mailto:a@example.com');
  });

  it('без VAPID: configured=false, подписка 409', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '');
    expect((await (await GET(req('GET'))).json()).data).toEqual({ configured: false, publicKey: null, devices: 0 });
    expect((await POST(req('POST', SUB))).status).toBe(409);
    expect((await TEST(req('POST'))).status).toBe(409);
  });

  it('подписка, тест (раз в минуту), отписка', async () => {
    expect((await (await GET(req('GET'))).json()).data).toEqual({ configured: true, publicKey: KEY, devices: 0 });
    const r = await POST(req('POST', SUB));
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual({ subscribed: true, devices: 1 });
    const t1 = await TEST(req('POST'));
    expect((await t1.json()).data).toEqual({ sent: 1, removed: 0 });
    expect(sent).toEqual([SUB.endpoint]);
    expect((await TEST(req('POST'))).status).toBe(429);
    expect((await (await DELETE(req('DELETE', { endpoint: SUB.endpoint }))).json()).data).toEqual({ subscribed: false, devices: 0 });
  });

  it('400: чужой адрес, кривые ключи, не JSON, чужой Origin; 503 без утечки', async () => {
    expect((await POST(req('POST', { ...SUB, endpoint: 'https://evil.example/x' }))).status).toBe(400);
    expect((await POST(req('POST', { ...SUB, keys: { p256dh: 'x', auth: 'y' } }))).status).toBe(400);
    expect((await POST(new Request('http://x/api/me/push', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }))).status).toBe(400);
    expect((await POST(req('POST', SUB, { origin: 'https://evil.example' }))).status).toBe(400);
    holder.db = null;
    const r = await GET(req('GET'));
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain('SECRETPASS');
  });
});
