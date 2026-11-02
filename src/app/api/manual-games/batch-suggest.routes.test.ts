// Фаза 43.1: пакетный роут и подсказки (режим suggest): 401/400, частичный успех, 429 suggest_limited с resetAt, общий лимит RAWG не ломается.
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { resetProviderUsageMemory } from '@/server/usage/provider-usage';
import { resetSuggestQuotaMemory } from '@/server/usage/suggest-quota';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('postgres://user:SECRETPASS@host/db unreachable');
    return holder.db;
  },
}));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);
vi.mock('@/server/env', async (orig) => ({ ...(await orig<typeof import('@/server/env')>()), getRawgKey: () => 'KEY' }));

import { POST as batch } from './batch/route';
import { GET as searchGet } from './search/route';

const json = { 'content-type': 'application/json' };
const item = (id: string, o: Record<string, unknown> = {}) => ({ externalSource: 'rawg', externalId: id, title: `Game ${id}`, coverUrl: null, releaseDate: null, ...o });
const postBatch = (items: unknown, headers: Record<string, string> = json) => batch(new Request('http://x/api/manual-games/batch', { method: 'POST', headers, body: JSON.stringify({ items }) }));
const body = async (r: Response) => (await r.json()) as { ok: boolean; data?: any; error?: { code: string; details?: Record<string, any> } }; // eslint-disable-line @typescript-eslint/no-explicit-any -- тестовый разбор ответа
const sug = (q: string) => searchGet(new Request(`http://x/api/manual-games/search?q=${encodeURIComponent(q)}&mode=suggest`));

describe('POST /api/manual-games/batch', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insert(schema.allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.db.delete(schema.manualGames);
    holder.db = t.db;
    resetTestSession();
  });

  it('401, 400 (пусто, >10, лишнее поле, Origin, не JSON)', async () => {
    testSession.anonymous = true;
    expect((await postBatch([item('1')])).status).toBe(401);
    resetTestSession();
    expect((await postBatch([])).status).toBe(400);
    expect((await postBatch(Array.from({ length: 11 }, (_, i) => item(String(i))))).status).toBe(400);
    expect((await postBatch([item('1', { x: 1 })])).status).toBe(400);
    expect((await postBatch([item('1')], {})).status).toBe(400);
    expect((await postBatch([item('1')], { ...json, origin: 'http://evil.example', host: 'x' })).status).toBe(400);
  });

  it('частичный успех и повтор пачки', async () => {
    await t.db.insert(schema.games).values({ userId: 1, category: 'ps4_game', lastSeenAt: new Date(), titleId: 'X', name: 'Owned Game' });
    const items = [item('1'), item('2', { title: 'Owned Game' }), item('3', { notPurchased: false })];
    const r = await body(await postBatch(items));
    expect(r.data.created).toBe(2);
    expect(r.data.results.map((x: { status: string }) => x.status)).toEqual(['created', 'duplicate', 'created']);
    expect(r.data.results[2].item.notPurchased).toBe(false);
    const r2 = await body(await postBatch(items));
    expect(r2.data.results.map((x: { status: string }) => x.status)).toEqual(['exists', 'duplicate', 'exists']);
    testSession.userId = 2;
    expect((await body(await postBatch([item('1')]))).data.results[0].status).toBe('created');
  });

  it('БД недоступна: 503 без текста исключения', async () => {
    holder.db = null;
    const r = await postBatch([item('1')]);
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain('SECRETPASS');
  });
});

describe('GET /api/manual-games/search?mode=suggest', () => {
  let t: TestDb;
  let calls: string[];
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    holder.db = t.db;
    resetTestSession();
    resetProviderUsageMemory();
    resetSuggestQuotaMemory();
    calls = [];
    delete process.env.RAWG_SUGGEST_DAILY_LIMIT;
    delete process.env.RAWG_USER_DAILY_LIMIT;
    vi.stubGlobal('fetch', async (u: URL) => {
      calls.push(String(u));
      return new Response(JSON.stringify({ results: [{ id: 1, name: `Hades ${calls.length}`, platforms: [{ platform: { name: 'PS5', slug: 'playstation5' } }] }] }));
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  const used = async () => (await t.db.select().from(schema.providerUsage).where(and(eq(schema.providerUsage.userId, 1), eq(schema.providerUsage.provider, 'rawg'))))[0]?.calls ?? 0;

  it('400: короче 3 символов, чужой mode; 401 без сессии', async () => {
    expect((await sug('ha')).status).toBe(400);
    expect((await searchGet(new Request('http://x/api/manual-games/search?q=hades&mode=full'))).status).toBe(400);
    testSession.anonymous = true;
    expect((await sug('hades')).status).toBe(401);
  });

  it('page_size=8, кэш не тратит лимит и не пишет provider_usage', async () => {
    const a = await body(await sug('hades'));
    const b = await body(await sug('Hades'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('page_size=8');
    expect([a.data.cached, b.data.cached, await used()]).toEqual([false, true, 1]);
  });

  it('мягкий предел: 429 rate_limited / suggest_limited с resetAt, RAWG не вызван, лимит не списан; Enter-поиск работает', async () => {
    process.env.RAWG_SUGGEST_DAILY_LIMIT = '2';
    expect((await sug('aaa')).status).toBe(200);
    expect((await sug('bbb')).status).toBe(200);
    const r = await sug('ccc');
    expect(r.status).toBe(429);
    const e = await body(r);
    expect(e.error).toMatchObject({ code: 'rate_limited', details: { reason: 'suggest_limited' } });
    expect(e.error!.details!.resetAt).toMatch(/T21:00:00\.000Z$/);
    expect(calls).toHaveLength(2);
    expect(await used()).toBe(2);
    expect((await searchGet(new Request('http://x/api/manual-games/search?q=ccc'))).status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(await used()).toBe(3);
    // кэш по-прежнему отвечает при исчерпанном пределе
    expect((await sug('aaa')).status).toBe(200);
  });

  it('подсказки не доедают общий лимит: стоп на 80% лимита RAWG профиля, остаток доступен Enter-поиску', async () => {
    process.env.RAWG_USER_DAILY_LIMIT = '10'; // порог подсказок 8, предел подсказок min(30, 5)=5
    process.env.RAWG_SUGGEST_DAILY_LIMIT = '30';
    await t.db.insert(schema.providerUsage).values({ userId: 1, day: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date()), provider: 'rawg', calls: 6 });
    expect((await sug('ddd')).status).toBe(200); // 7
    expect((await sug('eee')).status).toBe(200); // 8
    const r = await sug('fff');
    expect(r.status).toBe(429);
    expect((await searchGet(new Request('http://x/api/manual-games/search?q=fff'))).status).toBe(200); // 9, общий лимит не сломан
    expect(await used()).toBe(9);
  });

  it('малый лимит RAWG профиля ограничивает подсказки раньше', async () => {
    process.env.RAWG_USER_DAILY_LIMIT = '2'; // подсказки: min(30,1)=1
    expect((await sug('jjj')).status).toBe(200);
    expect((await body(await sug('kkk'))).error!.details!.reason).toBe('suggest_limited');
  });

  it('жёсткая квота RAWG в suggest: 429 reason=quota с resetAt (отличается от suggest_limited)', async () => {
    process.env.RAWG_USER_DAILY_LIMIT = '2';
    process.env.RAWG_SUGGEST_DAILY_LIMIT = '30';
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 429 }));
    const r = await sug('qqq');
    expect(r.status).toBe(429);
    const e = await body(r);
    expect(e.error).toMatchObject({ code: 'rate_limited', details: { reason: 'quota' } });
    expect(e.error!.details!.resetAt).toMatch(/T21:00:00\.000Z$/);
  });
});
