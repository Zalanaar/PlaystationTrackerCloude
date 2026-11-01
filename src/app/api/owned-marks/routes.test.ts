// API «Уже есть» (Фаза 40, 40.2): валидация, Origin, 401, 404 без раскрытия чужих игр, изоляция, 503 без утечек, фильтр в каталоге Плана.
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

import { GET as upcomingGet } from '@/app/api/roadmap/catalog/upcoming/route';
import { GET as searchGet } from '@/app/api/roadmap/catalog/search/route';
import { DELETE } from './[externalId]/route';
import { GET as librarySearch } from './library-search/route';
import { GET as recent } from './recent-collections/route';
import { GET, PUT } from './route';

const json = { 'content-type': 'application/json' };
const evil = { ...json, origin: 'http://evil.example', host: 'x' };
const put = (body: unknown, headers: Record<string, string> = json) =>
  PUT(new Request('http://x/api/owned-marks', { method: 'PUT', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const del = (id: string, headers: Record<string, string> = {}) =>
  DELETE(new Request('http://x/api/owned-marks/' + id, { method: 'DELETE', headers }), { params: Promise.resolve({ externalId: id }) });
const base = { externalSource: 'rawg', externalId: '3328', title: 'Uncharted 3', coverUrl: 'https://media.rawg.io/a.jpg' };

describe('маршруты owned-marks', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.insert(schema.allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' });
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    holder.db = t.db;
    resetTestSession();
  });

  const addGame = async (userId: number, name: string) =>
    (await t.db.insert(schema.games).values({ userId, category: 'ps4_game', lastSeenAt: new Date(), titleId: `${userId}-${name}`, name }).returning({ id: schema.games.id }))[0].id;

  it('401 без сессии на всех роутах', async () => {
    testSession.anonymous = true;
    expect((await GET(new Request('http://x/api/owned-marks'))).status).toBe(401);
    expect((await put({ ...base, kind: 'not_in_library', completed: true })).status).toBe(401);
    expect((await del('1')).status).toBe(401);
    expect((await recent(new Request('http://x/api/owned-marks/recent-collections'))).status).toBe(401);
    expect((await librarySearch(new Request('http://x/api/owned-marks/library-search?q=a'))).status).toBe(401);
  });

  it('PUT: not_in_library и covered, GET список, DELETE «вернуть в подборку» идемпотентен', async () => {
    const g = await addGame(1, 'Uncharted: Legacy of Thieves Collection');
    const a = await put({ ...base, kind: 'not_in_library', completed: true });
    expect(a.status).toBe(200);
    expect(a.headers.get('cache-control')).toBe('no-store');
    expect((await a.json()).data.mark).toMatchObject({ externalId: '3328', kind: 'not_in_library', completed: true, coveredBy: null });
    const b = (await (await put({ ...base, kind: 'covered', coveredByGameId: g })).json()).data.mark;
    expect(b).toMatchObject({ kind: 'covered', completed: false, coveredBy: { gameId: g, name: 'Uncharted: Legacy of Thieves Collection' } });
    expect((await (await GET(new Request('http://x/api/owned-marks'))).json()).data.marks).toHaveLength(1);
    const rec = (await (await recent(new Request('http://x/api/owned-marks/recent-collections'))).json()).data.collections;
    expect(rec).toMatchObject([{ gameId: g, coveredCount: 1 }]);
    expect((await (await del('3328')).json()).data).toEqual({ externalId: '3328', removed: true });
    expect((await (await del('3328')).json()).data).toEqual({ externalId: '3328', removed: false });
  });

  it('PUT: 400 на мусор, Origin, не JSON, взаимоисключающие поля; 404 на чужую игру без раскрытия', async () => {
    const theirs = await addGame(2, 'Theirs');
    expect((await put({ ...base, kind: 'not_in_library' })).status).toBe(400);
    expect((await put({ ...base, kind: 'covered', coveredByGameId: 1, completed: true })).status).toBe(400);
    expect((await put({ ...base, kind: 'not_in_library', completed: true }, evil)).status).toBe(400);
    expect((await put('{', json)).status).toBe(400);
    expect((await put({ ...base, kind: 'not_in_library', completed: true }, {})).status).toBe(400);
    const foreign = await put({ ...base, kind: 'covered', coveredByGameId: theirs });
    const missing = await put({ ...base, kind: 'covered', coveredByGameId: 99999 });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
    expect(await t.db.select().from(schema.ownedMarks)).toHaveLength(0);
  });

  it('DELETE: чужую отметку не удалить, 400 на плохой id и Origin', async () => {
    testSession.userId = 2;
    await put({ ...base, kind: 'not_in_library', completed: true });
    testSession.userId = 1;
    expect((await (await del('3328')).json()).data.removed).toBe(false);
    expect(await t.db.select().from(schema.ownedMarks)).toHaveLength(1);
    expect((await del('a%20b')).status).toBe(400);
    expect((await del('3328', { origin: 'http://evil.example', host: 'x' })).status).toBe(400);
    expect((await (await GET(new Request('http://x/api/owned-marks'))).json()).data.marks).toEqual([]);
  });

  it('library-search и recent-collections: параметры и изоляция', async () => {
    await addGame(1, 'Uncharted Collection');
    await addGame(2, 'Uncharted Foreign');
    const s = (q: string) => librarySearch(new Request('http://x/api/owned-marks/library-search?' + q));
    expect((await (await s('q=uncharted')).json()).data.games.map((x: { name: string }) => x.name)).toEqual(['Uncharted Collection']);
    expect((await s('q=')).status).toBe(400);
    expect((await s('')).status).toBe(400);
    expect((await s('q=a&limit=99')).status).toBe(400);
    expect((await recent(new Request('http://x/api/owned-marks/recent-collections?limit=0'))).status).toBe(400);
    expect((await recent(new Request('http://x/api/owned-marks/recent-collections?limit=11'))).status).toBe(400);
  });

  it('503 без утечки строки подключения', async () => {
    holder.db = null;
    for (const r of [await GET(new Request('http://x/api/owned-marks')), await put({ ...base, kind: 'not_in_library', completed: true }), await del('1')]) {
      expect(r.status).toBe(503);
      expect(JSON.stringify(await r.json())).not.toContain('SECRETPASS');
    }
  });

  describe('каталог Плана без отмеченных', () => {
    const cand = (id: string, title: string) => ({ id: Number(id), name: title, slug: title, released: '2027-03-01', tba: false, background_image: null, platforms: [{ platform: { name: 'p', slug: 'playstation5' } }], genres: [], tags: [] });
    beforeEach(() => {
      vi.stubEnv('RAWG_API_KEY', 'rawg_SECRET');
      vi.stubEnv('RAWG_DAILY_LIMIT', '');
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ next: null, results: [cand('1', 'Alpha'), cand('2', 'Beta')] }), { status: 200 }));
    });
    afterAll(() => vi.unstubAllGlobals());

    it('upcoming и search убирают отмеченную игру этого пользователя, у другого она остаётся; отмена возвращает', async () => {
      const up = async () => ((await (await upcomingGet(new Request('http://x/api/roadmap/catalog/upcoming'))).json()).data.candidates as { externalId: string }[]).map((c) => c.externalId);
      const se = async () => ((await (await searchGet(new Request('http://x/api/roadmap/catalog/search?q=alpha'))).json()).data.candidates as { externalId: string }[]).map((c) => c.externalId);
      expect((await up()).sort()).toEqual(['1', '2']);
      await put({ ...base, externalId: '1', title: 'Alpha', kind: 'not_in_library', completed: true });
      expect(await up()).toEqual(['2']);
      expect(await se()).toEqual(['2']);
      testSession.userId = 2;
      expect((await up()).sort()).toEqual(['1', '2']);
      testSession.userId = 1;
      await del('1');
      expect((await up()).sort()).toEqual(['1', '2']);
    });
  });
});
