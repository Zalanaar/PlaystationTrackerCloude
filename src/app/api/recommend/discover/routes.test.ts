// API «У тебя нет» (Фаза 30, 30.2, 30.5): чтение подборки, «Не интересно», Origin, 401, 503 без утечек, изоляция.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { testSession, resetTestSession } from '@/server/auth/test-require-user';
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

import { DELETE } from './dislike/[externalId]/route';
import { POST } from './dislike/route';
import { GET } from './route';

const json = { 'content-type': 'application/json' };
const evil = { ...json, origin: 'http://evil.example', host: 'x' };
const post = (body: unknown, headers: Record<string, string> = json) =>
  POST(new Request('http://x/api/recommend/discover/dislike', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const del = (id: string, headers: Record<string, string> = {}) =>
  DELETE(new Request('http://x/api/recommend/discover/dislike/' + id, { method: 'DELETE', headers }), { params: Promise.resolve({ externalId: id }) });
const valid = { externalSource: 'rawg', externalId: '3328', title: 'The Witcher 3', coverUrl: 'https://media.rawg.io/a.jpg' };
const get = () => GET(new Request('http://x/api/recommend/discover'));

const cachePayload = {
  version: 1, complete: true, fetched: ['all'], pool: [],
  candidates: [
    { externalId: '3328', title: 'The Witcher 3', slug: 'witcher-3', releaseDate: '2015-05-19', coverUrl: 'https://media.rawg.io/a.jpg', platforms: ['PS4'], genres: ['ROLE_PLAYING_GAMES'], rating: 4.6, metacritic: 92, score: 0.9, reason: { text: 'Фраза.', source: 'template' } },
    { externalId: '1', title: 'Other Game', slug: 'other-game', releaseDate: '2018-01-01', coverUrl: null, platforms: ['PS5'], genres: [], rating: null, metacritic: 80, score: 0.1, reason: { text: 'Ещё.', source: 'llm' } },
  ],
};

describe('маршруты «У тебя нет»', () => {
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
    vi.stubEnv('RAWG_API_KEY', 'rawg_ROUTE_SECRET');
    vi.stubEnv('RAWG_DAILY_LIMIT', '');
  });

  const seedCache = (userId = 1) =>
    t.db.insert(schema.recommendDiscoverCache).values({ userId, day: '2026-10-31', profileHash: 'h', payload: cachePayload, createdAt: new Date('2026-10-31T05:00:00Z') });

  it('GET без подборки: 200, пусто, not_generated; ничего не вызывается', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const d = (await r.json()).data;
    expect(d.items).toEqual([]);
    expect(d.meta).toMatchObject({ catalog: 'ok', reason: 'not_generated', limit: 12 });
  });

  it('GET без RAWG_API_KEY: catalog unavailable', async () => {
    vi.stubEnv('RAWG_API_KEY', '');
    expect((await (await get()).json()).data.meta.catalog).toBe('unavailable');
  });

  it('GET с подборкой: поля карточки, порядок по score; «Не интересно» убирает игру сразу, DELETE возвращает', async () => {
    await seedCache();
    const first = (await (await get()).json()).data;
    expect(first.items.map((i: { title: string }) => i.title)).toEqual(['The Witcher 3', 'Other Game']);
    expect(first.items[0]).toMatchObject({
      externalId: '3328', platforms: ['PS4'], genres: ['ROLE_PLAYING_GAMES'], rating: 4.6, metacritic: 92, rawgUrl: 'https://rawg.io/games/witcher-3',
      reason: { text: 'Фраза.', source: 'template' }, planned: false, plannedId: null,
    });
    expect(first.meta.generatedAt).toBe('2026-10-31T05:00:00.000Z');
    expect((await post(valid)).status).toBe(200);
    expect((await (await get()).json()).data.items.map((i: { title: string }) => i.title)).toEqual(['Other Game']);
    expect((await del('3328')).status).toBe(200);
    expect((await del('3328')).status).toBe(200);
    expect((await (await get()).json()).data.items).toHaveLength(2);
  });

  it('POST dislike: валидация тела, Content-Type, Origin; идемпотентность; coverUrl null', async () => {
    const bad = [{}, { ...valid, externalSource: 'igdb' }, { ...valid, externalId: '' }, { ...valid, externalId: 'a/b' }, { ...valid, externalId: 'x'.repeat(65) },
      { ...valid, title: '' }, { ...valid, title: 'x'.repeat(201) }, { ...valid, coverUrl: 'http://insecure/a.jpg' }, { ...valid, coverUrl: undefined }, { ...valid, extra: 1 }, [], '{bad'];
    for (const b of bad) expect((await post(b)).status, JSON.stringify(b)).toBe(400);
    expect((await post(valid, {})).status).toBe(400);
    expect((await post(valid, evil)).status).toBe(400);
    expect((await post(valid)).status).toBe(200);
    expect((await (await post({ ...valid, coverUrl: null })).json()).data).toEqual({ externalId: '3328' });
    expect(await t.db.select().from(schema.recommendExternalDislikes)).toHaveLength(1);
  });

  it('DELETE: некорректный id и Origin = 400', async () => {
    expect((await del('a b')).status).toBe(400);
    expect((await del('3328', evil)).status).toBe(400);
  });

  it('401 без сессии для всех трёх роутов', async () => {
    testSession.anonymous = true;
    expect((await get()).status).toBe(401);
    expect((await post(valid)).status).toBe(401);
    expect((await del('1')).status).toBe(401);
  });

  it('503 без БД, секреты не утекают', async () => {
    holder.db = null;
    for (const r of [await get(), await post(valid), await del('1')]) {
      expect(r.status).toBe(503);
      const text = JSON.stringify(await r.json());
      expect(text).toContain('db_unavailable');
      expect(text).not.toMatch(/SECRETPASS|postgres:|rawg_ROUTE_SECRET/);
    }
  });

  it('изоляция: подборка и «Не интересно» одного пользователя не видны другому', async () => {
    await seedCache(1);
    testSession.userId = 2;
    testSession.role = 'member';
    expect((await (await get()).json()).data.meta.reason).toBe('not_generated');
    expect((await post(valid)).status).toBe(200); // дизлайк пользователя 2
    testSession.userId = 1;
    testSession.role = 'owner';
    expect((await (await get()).json()).data.items).toHaveLength(2);
    expect((await t.db.select().from(schema.recommendExternalDislikes))[0].userId).toBe(2);
    testSession.userId = 2;
    expect((await del('3328')).status).toBe(200);
    expect(await t.db.select().from(schema.recommendExternalDislikes)).toHaveLength(0);
    // DELETE пользователя 2 не трогает дизлайк пользователя 1
    testSession.userId = 1;
    await post(valid);
    testSession.userId = 2;
    await del('3328');
    expect((await t.db.select().from(schema.recommendExternalDislikes))[0].userId).toBe(1);
  });
});
