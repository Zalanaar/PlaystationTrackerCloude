// П13.4: GET /api/me/checklist и POST …/dismiss — 401, ответ, скрытие, 503 без утечки строки подключения.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
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

import { GET } from './route';
import { POST } from './dismiss/route';

const get = () => GET(new Request('http://x/api/me/checklist'));
const dismiss = () => POST(new Request('http://x/api/me/checklist/dismiss', { method: 'POST' }));

describe('маршруты «Первой недели»', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset(); holder.db = t.db; resetTestSession();
    await t.db.update(schema.allowedUsers).set({ onboardedAt: new Date() }).where(eq(schema.allowedUsers.id, TEST_USER));
  });

  it('401 без сессии', async () => {
    testSession.anonymous = true;
    expect((await get()).status).toBe(401);
    expect((await dismiss()).status).toBe(401);
  });
  it('показ и скрытие', async () => {
    expect((await (await get()).json()).data.show).toBe(true);
    expect((await (await dismiss()).json()).data).toEqual({ dismissed: true });
    expect((await (await get()).json()).data.show).toBe(false);
  });
  it('503 без утечки', async () => {
    holder.db = null;
    for (const res of [await get(), await dismiss()]) {
      expect(res.status).toBe(503);
      expect(await res.text()).not.toContain('SECRETPASS');
    }
  });
});
