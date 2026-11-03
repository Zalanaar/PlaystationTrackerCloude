// QA Фазы 12: маршруты на PGlite (404/409/503), энкодинг q для RAWG, ключ не утекает.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('no db');
    return holder.db;
  },
}));

import { GET as roadmapGet } from './route';
import { GET as catalogGet } from './catalog/search/route';
import { PUT as orderPut } from './order/route';
import { DELETE as plannedDelete, PATCH as plannedPatch } from './planned/[id]/route';
import { POST as plannedPost } from './planned/route';
import { PUT as settingsPut } from './settings/route';

vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

const json = { 'content-type': 'application/json' };
const req = (method: string, body: unknown) => new Request('http://x/api/roadmap', { method, headers: json, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('маршруты роадмапа на БД', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); holder.db = t.db; });
  afterEach(() => { holder.db = t.db; });

  it('503 при недоступной БД на всех чтениях и мутациях, без утечки текста ошибки', async () => {
    holder.db = null;
    for (const r of [await roadmapGet(new Request('http://x/')), await settingsPut(req('PUT', { year: 2026, hoursPerWeek: 5 })), await plannedPost(req('POST', { title: 'A' })), await orderPut(req('PUT', { gameIds: [] })), await plannedDelete(new Request('http://x', { method: 'DELETE' }), params('1'))]) {
      expect(r.status).toBe(503);
      expect(await r.text()).not.toContain('no db');
    }
  });
  it('404 на PATCH/DELETE несуществующего; 409 на дубль каталога с id существующей', async () => {
    expect((await plannedPatch(req('PATCH', { title: 'A' }), params('999'))).status).toBe(404);
    expect((await plannedDelete(new Request('http://x', { method: 'DELETE' }), params('999'))).status).toBe(404);
    const body = { title: 'Hades II', externalSource: 'rawg', externalId: '77' };
    const a = await plannedPost(req('POST', body));
    expect(a.status).toBe(200);
    const id = (await a.json()).data.planned.id;
    const b = await plannedPost(req('POST', body));
    expect(b.status).toBe(409);
    const j = await b.json();
    expect(j.error).toMatchObject({ code: 'planned_duplicate', details: { id } });
  });
  it('PATCH: галка без даты = 400; снятие даты у игры с галкой = 400; смена статуса убирает игру из плана', async () => {
    const c = await (await plannedPost(req('POST', { title: 'G', releaseDate: '2026-12-01', wantAtRelease: true, hoursManual: 10 }))).json();
    const id = String(c.data.planned.id);
    expect((await plannedPatch(req('PATCH', { releaseDate: null }), params(id))).status).toBe(400);
    await settingsPut(req('PUT', { year: 2026, hoursPerWeek: 10 }));
    let plan = (await (await roadmapGet(new Request('http://x/'))).json()).data;
    expect(plan.items.map((i: { key: string }) => i.key)).toEqual([`p:${id}`]);
    expect((await plannedPatch(req('PATCH', { status: 'cancelled' }), params(id))).status).toBe(200);
    plan = (await (await roadmapGet(new Request('http://x/'))).json()).data;
    expect(plan.items).toEqual([]);
    expect(plan.notFit).toEqual([]);
  });
  it('смена бюджета и повторный GET пересчитывают план', async () => {
    const { games, gameStatus } = schema;
    const [g] = await t.db.insert(games).values({ userId: 1, titleId: 'X', name: 'X', category: 'ps5_native_game', lastSeenAt: new Date(), hltbMainHours: 20 }).returning({ id: games.id });
    await t.db.insert(gameStatus).values({ userId: 1, gameId: g.id, status: 'backlog' });
    await settingsPut(req('PUT', { year: 2026, hoursPerWeek: 10 }));
    const d1 = (await (await roadmapGet(new Request('http://x/'))).json()).data.items[0].days;
    await settingsPut(req('PUT', { year: 2026, hoursPerWeek: 20 }));
    const d2 = (await (await roadmapGet(new Request('http://x/'))).json()).data.items[0].days;
    expect([d1, d2]).toEqual([14, 7]);
  });
});

describe('RAWG: энкодинг q и утечки', () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.RAWG_API_KEY; });
  it('служебные символы в q остаются значением search, ключ и page_size не подменяются', async () => {
    process.env.RAWG_API_KEY = 'KEY_SECRET_XYZ';
    let seen = '';
    vi.stubGlobal('fetch', async (u: URL) => { seen = String(u); return new Response(JSON.stringify({ results: [] })); });
    const q = 'a&key=EVIL&page_size=1000#frag ?x=1/../';
    const r = await catalogGet(new Request(`http://x/api/roadmap/catalog/search?q=${encodeURIComponent(q)}`));
    expect(r.status).toBe(200);
    const u = new URL(seen);
    expect(u.host).toBe('api.rawg.io');
    expect(u.pathname).toBe('/api/games');
    expect(u.searchParams.getAll('key')).toEqual(['KEY_SECRET_XYZ']);
    expect(u.searchParams.getAll('page_size')).toEqual(['10']);
    expect(u.searchParams.get('search')).toBe(q);
    expect(u.hash).toBe('');
  });
  it('http_error/плохой JSON/429: 503 без ключа в теле; обложка не https отбрасывается', async () => {
    process.env.RAWG_API_KEY = 'KEY_SECRET_XYZ';
    for (const res of [new Response('x', { status: 500 }), new Response('{', { status: 200 }), new Response('', { status: 429 })]) {
      vi.stubGlobal('fetch', async () => res);
      const r = await catalogGet(new Request('http://x/api/roadmap/catalog/search?q=zelda'));
      expect(r.status).toBe(503);
      expect(await r.text()).not.toContain('KEY_SECRET_XYZ');
    }
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ results: [{ id: 1, name: 'Z', background_image: 'http://x/a.jpg', released: '2026-02-30' }] })));
    const ok = await (await catalogGet(new Request('http://x/api/roadmap/catalog/search?q=zelda'))).json();
    expect(ok.data.candidates[0]).toMatchObject({ coverUrl: null, releaseDate: null });
  });
});
