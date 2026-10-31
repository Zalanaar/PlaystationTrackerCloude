// QA Фазы 21: fail-open GET/PUT /api/me/tour (БД недоступна, миграция 0016 не применена) и клиент api.ts.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@/db';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { getUserById } from '@/server/auth/users';

const holder: { db: TestDb['db'] | null; fail: boolean } = { db: null, fail: false };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (holder.fail || !holder.db) throw new Error('db down');
    return holder.db;
  },
}));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);
const { GET, PUT } = await import('./route');

let t: TestDb;
const put = (body: unknown = { done: true, version: 1 }) =>
  PUT(new Request('http://x/api/me/tour', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const get = () => GET(new Request('http://x/api/me/tour'));

beforeAll(async () => {
  t = await createTestDb();
  holder.db = t.db;
  await t.db.insert(schema.allowedUsers).values({ email: 'a@example.com', role: 'member', status: 'active' });
});
afterAll(async () => {
  holder.db = null;
  await t.close();
});
afterEach(() => {
  holder.fail = false;
  resetTestSession();
});

describe('fail-open на сервере', () => {
  it('getDb бросает: GET и PUT отвечают 503 db_unavailable JSON, не падают', async () => {
    holder.fail = true;
    for (const r of [await get(), await put()]) {
      expect(r.status).toBe(503);
      const j = await r.json();
      expect(j).toMatchObject({ ok: false, error: { code: 'db_unavailable' } });
      expect(JSON.stringify(j)).not.toMatch(/db down|stack|at /);
    }
  });

  it('миграция 0016 не применена (колонок нет): GET/PUT 503 с чистым телом, без утечки текста SQL', async () => {
    testSession.userId = 2;
    testSession.role = 'member';
    await t.db.execute(sql`ALTER TABLE allowed_users DROP COLUMN tour_version, DROP COLUMN tour_completed_at`);
    try {
      for (const r of [await get(), await put()]) {
        expect(r.status).toBe(503);
        const text = await r.text();
        expect(text).not.toMatch(/tour_version|column|select|update/i);
      }
      // ЗАФИКСИРОВАНО: полный select() из allowed_users (auth/users.ts) тоже обращается к новым колонкам.
      // Код 21 нельзя выкладывать до SQL 0016: иначе requireUser отвечает 503 на каждом API (не только на туре).
      await expect(getUserById(t.db, 2)).rejects.toThrow();
    } finally {
      await t.db.execute(sql`ALTER TABLE allowed_users ADD COLUMN tour_version integer, ADD COLUMN tour_completed_at timestamptz`);
    }
  });
});

describe('fail-open клиента (api.ts)', () => {
  const ls = new Map<string, string>();
  const stubStorage = () => vi.stubGlobal('localStorage', { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v), removeItem: (k: string) => void ls.delete(k) });
  afterEach(() => {
    vi.unstubAllGlobals();
    ls.clear();
  });

  it('GET: 500, 503, 401, сеть, не JSON, ok:false, неверная форма -> null без исключения', async () => {
    const { fetchTourState } = await import('@/ui/tour/api');
    const cases: Array<() => Promise<Response>> = [
      async () => new Response('{}', { status: 500 }),
      async () => new Response('{"ok":false}', { status: 503 }),
      async () => new Response('{}', { status: 401 }),
      async () => { throw new TypeError('network'); },
      async () => new Response('<html>', { status: 200 }),
      async () => new Response('{"ok":false}', { status: 200 }),
      async () => new Response('{"ok":true,"data":{"version":1}}', { status: 200 }),
      async () => new Response('{"ok":true,"data":{"version":"1","completedVersion":0,"shouldAutoStart":true}}', { status: 200 }),
    ];
    for (const c of cases) {
      vi.stubGlobal('fetch', vi.fn(c));
      await expect(fetchTourState()).resolves.toBeNull();
    }
  });

  it('GET: валидный ответ разбирается', async () => {
    const { fetchTourState } = await import('@/ui/tour/api');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true,"data":{"version":1,"completedVersion":0,"shouldAutoStart":true}}', { status: 200 })));
    await expect(fetchTourState()).resolves.toEqual({ version: 1, completedVersion: 0, shouldAutoStart: true });
  });

  it('PUT: 500/503/сеть -> false и локальный флаг ps-tour-seen; 200 -> true без флага', async () => {
    const { saveTourDone } = await import('@/ui/tour/api');
    stubStorage();
    for (const c of [async () => new Response('{}', { status: 500 }), async () => new Response('{}', { status: 503 }), async () => { throw new TypeError('network'); }]) {
      ls.clear();
      vi.stubGlobal('fetch', vi.fn(c));
      await expect(saveTourDone(1)).resolves.toBe(false);
      expect(ls.get('ps-tour-seen')).toBe('1');
    }
    ls.clear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true,"data":{}}', { status: 200 })));
    await expect(saveTourDone(1)).resolves.toBe(true);
    expect(ls.has('ps-tour-seen')).toBe(false);
  });

  it('PUT: localStorage недоступен (приватный режим) не бросает', async () => {
    const { saveTourDone } = await import('@/ui/tour/api');
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('denied'); }, getItem: () => null });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    await expect(saveTourDone(1)).resolves.toBe(false);
  });
});
