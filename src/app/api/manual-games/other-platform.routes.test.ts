// API «Играл на другой платформе» (Фаза 44, контракт 44.2-44.3): kind, 401, валидация, Origin, лимит, изоляция, поиск scope=all, 503 без утечек.
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
vi.mock('@/server/usage/rawg-reserve', () => ({ rawgReserve: () => async () => true, rawgSuggestReserve: () => async () => true }));

import { DELETE as delItem } from './[id]/route';
import { PUT as statusPut } from './[id]/status/route';
import { POST as bought } from './[id]/purchased/route';
import { GET, POST } from './route';
import { GET as searchGet } from './search/route';

const json = { 'content-type': 'application/json' };
const origin = { origin: 'http://x', host: 'x' };
const p = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const post = (body: unknown, headers: Record<string, string> = json) => POST(new Request('http://x/api/manual-games', { method: 'POST', headers, body: JSON.stringify(body) }));
const list = (q = '') => GET(new Request(`http://x/api/manual-games${q}`));
const base = { kind: 'other_platform', externalSource: 'rawg', externalId: '10', title: 'Halo Infinite', coverUrl: null, releaseDate: null, platformLabel: 'Xbox One' };
const body = async (r: Response) => (await r.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string; details?: Record<string, unknown> } };

describe('маршруты other_platform', () => {
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
    expect((await list('?kind=other_platform')).status).toBe(401);
    expect((await post(base)).status).toBe(401);
  });

  it('добавить, повторить (идемпотентно), список по kind, Бэклог не видит, удалить и вернуть', async () => {
    const a = await body(await post(base));
    expect(a.data).toMatchObject({ created: true, item: { kind: 'other_platform', externalId: '10', platformLabel: 'Xbox One' } });
    const id = (a.data!.item as { id: number }).id;
    expect((await body(await post(base))).data).toMatchObject({ created: false });
    expect((await body(await list('?kind=other_platform'))).data).toMatchObject({ items: [{ id }] });
    expect((await body(await list())).data).toEqual({ items: [] });
    expect((await body(await list('?nb=1'))).data).toEqual({ items: [] });
    expect((await list('?kind=zz')).status).toBe(400);
    // роуты Бэклога для записи other_platform: статус и «Купил» = 404
    expect((await statusPut(new Request('http://x', { method: 'PUT', headers: origin }), p(id))).status).toBe(404);
    expect((await bought(new Request('http://x', { method: 'POST', headers: origin }), p(id))).status).toBe(404);
    const del = await delItem(new Request('http://x', { method: 'DELETE', headers: origin }), p(id));
    expect((await body(del)).data).toEqual({ id, removed: true });
    expect((await body(await delItem(new Request('http://x', { method: 'DELETE', headers: origin }), p(id)))).data).toEqual({ id, removed: false });
    expect((await body(await post(base))).data).toMatchObject({ created: true }); // «Вернуть»
  });

  it('валидация: 400 на notPurchased, длинную подпись, чужой источник; Бэклог по-прежнему создаёт ps_backlog', async () => {
    for (const bad of [{ ...base, notPurchased: true }, { ...base, platformLabel: 'x'.repeat(61) }, { ...base, externalSource: 'igdb' }, { ...base, kind: 'weird' }]) {
      expect((await body(await post(bad))).error?.code).toBe('invalid_request');
    }
    const { kind: _k, platformLabel: _p, ...ps } = base;
    void _k;
    void _p;
    expect((await body(await post(ps))).data).toMatchObject({ created: true, item: { kind: 'ps_backlog', notPurchased: true } });
    expect((await body(await list())).data!.items).toHaveLength(1);
    expect((await body(await list('?kind=other_platform'))).data).toEqual({ items: [] });
  });

  it('лимит 300 = 409 manual_limit с details.limit', async () => {
    await t.db.insert(schema.manualGames).values(Array.from({ length: 300 }, (_, i) => ({ userId: 1, rawgId: `L${i}`, title: `T${i}`, kind: 'other_platform' })));
    const r = await post({ ...base, externalId: 'fresh', title: 'Fresh' });
    expect(r.status).toBe(409);
    expect((await body(r)).error).toMatchObject({ code: 'manual_limit', details: { limit: 300 } });
  });

  it('дубль с библиотекой = 409 duplicate_game, с confirmDuplicate создаётся', async () => {
    await t.db.insert(schema.games).values({ userId: 1, category: 'ps5_native_game', lastSeenAt: new Date(), titleId: 'Z', name: 'Halo Infinite' });
    const r = await post(base);
    expect(r.status).toBe(409);
    expect((await body(r)).error).toMatchObject({ code: 'duplicate_game', details: { duplicate: 'library' } });
    expect((await body(await post({ ...base, confirmDuplicate: true }))).data).toMatchObject({ created: true });
  });

  it('изоляция: чужая запись не видна и не удаляется', async () => {
    const id = ((await body(await post(base))).data!.item as { id: number }).id;
    testSession.userId = 2;
    expect((await body(await list('?kind=other_platform'))).data).toEqual({ items: [] });
    expect((await body(await delItem(new Request('http://x', { method: 'DELETE', headers: origin }), p(id)))).data).toEqual({ id, removed: false });
    resetTestSession();
    expect((await body(await list('?kind=other_platform'))).data!.items).toHaveLength(1);
  });

  it('поиск scope=all: без фильтра платформ, inList, 400 на mode, 503 без ключа', async () => {
    const q = (s: string) => searchGet(new Request(`http://x/api/manual-games/search?${s}`));
    expect((await q('q=halo&scope=all&mode=suggest')).status).toBe(400);
    expect((await q('q=halo&scope=zz')).status).toBe(400);
    expect((await body(await q('q=halo&scope=all'))).error).toMatchObject({ code: 'catalog_unavailable', details: { reason: 'no_key' } });
    rawg.key = 'k';
    let url = '';
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: URL) => {
      url = String(u);
      return new Response(JSON.stringify({ results: [{ id: 10, name: 'Halo Infinite', platforms: [{ platform: { name: 'Xbox One', slug: 'xbox-one' } }, { platform: { name: 'PC', slug: 'pc' } }] }] }), { status: 200 });
    }) as typeof fetch;
    try {
      await post({ ...base, title: 'Zzz' });
      const r = await body(await q('q=halo+unique&scope=all'));
      expect(url).not.toContain('platforms=');
      expect(r.data).toMatchObject({ cached: false, candidates: [{ externalId: '10', platforms: ['Xbox One', 'PC'], playstation: false, inList: true, inBacklog: false, duplicate: null }] });
    } finally {
      globalThis.fetch = real;
    }
  });

  it('503 без утечки текста исключения', async () => {
    holder.db = null;
    const r = await list('?kind=other_platform');
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain('SECRETPASS');
  });
});
