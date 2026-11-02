// API Бэклога «не куплено» (Фаза 43, контракт 43.2-43.5): 401, валидация, Origin, дубль 409, лимит RAWG с resetAt, изоляция, запрет статуса, 503 без утечек.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
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
const rawg = vi.hoisted(() => ({ key: null as string | null }));
vi.mock('@/server/env', async (orig) => ({ ...(await orig<typeof import('@/server/env')>()), getRawgKey: () => rawg.key }));
vi.mock('@/server/usage/rawg-reserve', () => ({ rawgReserve: () => async () => false }));

import { GET as matchesGet } from './matches/route';
import { GET, POST } from './route';
import { DELETE as delItem } from './[id]/route';
import { POST as answer } from './[id]/match/route';
import { DELETE as undo, POST as bought } from './[id]/purchased/route';
import { GET as searchGet } from './search/route';
import { PUT as statusPut } from './[id]/status/route';

const json = { 'content-type': 'application/json' };
const p = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const post = (body: unknown, headers: Record<string, string> = json) => POST(new Request('http://x/api/manual-games', { method: 'POST', headers, body: JSON.stringify(body) }));
const base = { externalSource: 'rawg', externalId: '10', title: 'Hades II', coverUrl: null, releaseDate: null };
const body = async (r: Response) => (await r.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string; details?: Record<string, unknown> } };

describe('маршруты manual-games', () => {
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
    rawg.key = null;
    resetTestSession();
  });

  it('401 без сессии', async () => {
    testSession.anonymous = true;
    expect((await GET(new Request('http://x/api/manual-games'))).status).toBe(401);
    expect((await post(base)).status).toBe(401);
    expect((await searchGet(new Request('http://x/api/manual-games/search?q=ab'))).status).toBe(401);
    expect((await matchesGet(new Request('http://x/api/manual-games/matches'))).status).toBe(401);
    expect((await delItem(new Request('http://x', { method: 'DELETE' }), p(1))).status).toBe(401);
  });

  it('добавить, список, nb, «Купил»/«Отменить», удалить', async () => {
    const a = await body(await post(base));
    expect(a.data).toMatchObject({ created: true, item: { source: 'manual', notPurchased: true, status: 'backlog' } });
    const id = (a.data!.item as { id: number }).id;
    expect((await body(await post(base))).data!.created).toBe(false);
    expect((await body(await GET(new Request('http://x/api/manual-games?nb=1')))).data!.items).toHaveLength(1);
    expect((await GET(new Request('http://x/api/manual-games?nb=x'))).status).toBe(400);
    const req = (m: string) => new Request('http://x/api/manual-games/1/purchased', { method: m });
    expect(((await body(await bought(req('POST'), p(id)))).data!.item as { notPurchased: boolean }).notPurchased).toBe(false);
    expect((await body(await GET(new Request('http://x/api/manual-games?nb=1')))).data!.items).toHaveLength(0);
    expect(((await body(await undo(req('DELETE'), p(id)))).data!.item as { notPurchased: boolean }).notPurchased).toBe(true);
    expect((await body(await delItem(new Request('http://x', { method: 'DELETE' }), p(id)))).data).toEqual({ id, removed: true });
    expect((await body(await delItem(new Request('http://x', { method: 'DELETE' }), p(id)))).data).toEqual({ id, removed: false });
  });

  it('валидация и Origin', async () => {
    expect((await post({ ...base, extra: 1 })).status).toBe(400);
    expect((await post({ ...base, title: '' })).status).toBe(400);
    expect((await post(base, {})).status).toBe(400);
    expect((await post(base, { ...json, origin: 'http://evil.example', host: 'x' })).status).toBe(400);
    expect((await delItem(new Request('http://x', { method: 'DELETE', headers: { origin: 'http://evil.example', host: 'x' } }), p(1))).status).toBe(400);
    expect((await delItem(new Request('http://x', { method: 'DELETE' }), p('abc'))).status).toBe(400);
    expect((await searchGet(new Request('http://x/api/manual-games/search?q=a'))).status).toBe(400);
  });

  it('дубль с библиотекой: 409 duplicate_game, повтор с confirmDuplicate добавляет', async () => {
    await t.db.insert(schema.games).values({ userId: 1, category: 'ps4_game', lastSeenAt: new Date(), titleId: 'X', name: 'Hades II' });
    const r = await post(base);
    expect(r.status).toBe(409);
    const e = await body(r);
    expect(e.error).toMatchObject({ code: 'duplicate_game', details: { duplicate: 'library', game: { name: 'Hades II' } } });
    expect((await post({ ...base, confirmDuplicate: true })).status).toBe(200);
  });

  it('чужие записи: 404 / removed false; статус запрещён 409, чужая и несуществующая запись 404', async () => {
    const id = ((await body(await post(base))).data!.item as { id: number }).id;
    const put = () => statusPut(new Request('http://x', { method: 'PUT', headers: json, body: '{"status":"playing"}' }), p(id));
    const r = await put();
    expect(r.status).toBe(409);
    expect((await body(r)).error!.code).toBe('manual_status_locked');
    testSession.userId = 2;
    expect((await put()).status).toBe(404);
    expect((await bought(new Request('http://x', { method: 'POST' }), p(id))).status).toBe(404);
    expect((await body(await delItem(new Request('http://x', { method: 'DELETE' }), p(id)))).data!.removed).toBe(false);
    expect((await body(await GET(new Request('http://x/api/manual-games')))).data!.items).toEqual([]);
    expect((await answer(new Request('http://x', { method: 'POST', headers: json, body: '{"answer":"yes"}' }), p(id))).status).toBe(404);
  });

  it('поиск: без ключа 503 catalog_unavailable; лимит RAWG с resetAt; ключ не в ответе', async () => {
    const r1 = await searchGet(new Request('http://x/api/manual-games/search?q=hades'));
    expect(r1.status).toBe(503);
    expect((await body(r1)).error).toMatchObject({ code: 'catalog_unavailable', details: { reason: 'no_key' } });
    rawg.key = 'SECRET_RAWG_KEY';
    const r2 = await searchGet(new Request('http://x/api/manual-games/search?q=hades-limit'));
    const txt = JSON.stringify(await r2.json());
    expect(r2.status).toBe(503);
    expect(txt).toContain('rate_limited');
    expect(txt).toMatch(/"resetAt":"\d{4}-\d{2}-\d{2}T21:00:00\.000Z"/);
    expect(txt).not.toContain('SECRET');
  });

  it('БД недоступна: 503 без текста исключения', async () => {
    holder.db = null;
    for (const r of [await GET(new Request('http://x/api/manual-games')), await post(base), await matchesGet(new Request('http://x/api/manual-games/matches'))]) {
      expect(r.status).toBe(503);
      expect(JSON.stringify(await r.json())).not.toContain('SECRETPASS');
    }
  });
});
