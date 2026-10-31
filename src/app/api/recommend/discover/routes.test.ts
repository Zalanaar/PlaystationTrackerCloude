// API «Новое от ИИ» (контракт 19.6, 19.7): валидация, Origin, идемпотентность, 503 без утечки, maxDuration.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('postgres://user:SECRETPASS@host/db unreachable');
    return holder.db;
  },
}));

import { DELETE } from './dislike/[externalId]/route';
import { POST } from './dislike/route';
import { GET as LIST } from './dislikes/route';
import * as discoverRoute from './route';

vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

const json = { 'content-type': 'application/json' };
const evil = { ...json, origin: 'http://evil.example', host: 'x' };
const post = (body: unknown, headers: Record<string, string> = json) =>
  POST(new Request('http://x/api/recommend/discover/dislike', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const del = (id: string, headers: Record<string, string> = {}) =>
  DELETE(new Request('http://x/api/recommend/discover/dislike/' + id, { method: 'DELETE', headers }), { params: Promise.resolve({ externalId: id }) });
const valid = { externalSource: 'rawg', externalId: '3328', title: 'The Witcher 3', coverUrl: 'https://media.rawg.io/a.jpg' };

describe('маршруты discover', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); holder.db = t.db; });

  it('maxDuration = 60', () => {
    expect(discoverRoute.maxDuration).toBe(60);
  });

  it('GET: неверный refresh = 400; без env Groq/RAWG = 200, items [], disabled', async () => {
    vi.stubEnv('LLM_PROVIDER', '');
    vi.stubEnv('LLM_API_KEY', '');
    vi.stubEnv('RAWG_API_KEY', '');
    for (const q of ['refresh=2', 'refresh=', 'refresh=yes']) {
      const r = await discoverRoute.GET(new Request(`http://x/api/recommend/discover?${q}`));
      expect(r.status, q).toBe(400);
      expect((await r.json()).error.code).toBe('invalid_request');
    }
    const r = await discoverRoute.GET(new Request('http://x/api/recommend/discover?refresh=1'));
    expect(r.status).toBe(200);
    const d = (await r.json()).data;
    expect(d.items).toEqual([]);
    expect(d.meta.llm).toBe('disabled');
    vi.unstubAllEnvs();
  });

  it('GET: 503 db_unavailable без БД, секреты не утекают', async () => {
    vi.stubEnv('LLM_PROVIDER', 'groq');
    vi.stubEnv('LLM_API_KEY', 'gsk_LEAKCHECK');
    holder.db = null;
    const r = await discoverRoute.GET(new Request('http://x/api/recommend/discover'));
    expect(r.status).toBe(503);
    const text = JSON.stringify(await r.json());
    expect(text).toContain('db_unavailable');
    expect(text).not.toMatch(/SECRETPASS|postgres:|gsk_LEAKCHECK/);
    vi.unstubAllEnvs();
  });

  it('GET без таблиц миграции 0011 = 503', async () => {
    vi.stubEnv('LLM_PROVIDER', 'groq');
    vi.stubEnv('LLM_API_KEY', 'k');
    vi.stubEnv('RAWG_API_KEY', 'k');
    await t.pg.execute('drop table recommend_discover_cache');
    const r = await discoverRoute.GET(new Request('http://x/api/recommend/discover'));
    expect(r.status).toBe(503);
    vi.unstubAllEnvs();
    // вернуть таблицу для следующих тестов
    await t.pg.execute(`create table recommend_discover_cache (day date primary key, profile_hash text not null, payload jsonb not null, refreshes integer not null default 0, created_at timestamptz not null default now())`);
  });

  it('POST dislike: валидация тела, Content-Type, Origin', async () => {
    const bad = [{}, { ...valid, externalSource: 'igdb' }, { ...valid, externalId: '' }, { ...valid, externalId: 'a/b' }, { ...valid, externalId: 'x'.repeat(65) },
      { ...valid, title: '' }, { ...valid, title: 'x'.repeat(201) }, { ...valid, coverUrl: 'http://insecure/a.jpg' }, { ...valid, coverUrl: undefined }, { ...valid, extra: 1 }, [], '{bad'];
    for (const b of bad) expect((await post(b)).status, JSON.stringify(b)).toBe(400);
    expect((await post(valid, {})).status).toBe(400);
    expect((await post(valid, evil)).status).toBe(400);
  });

  it('POST/GET/DELETE: идемпотентно, coverUrl может быть null', async () => {
    expect((await post(valid)).status).toBe(200);
    const again = await post({ ...valid, coverUrl: null });
    expect((await again.json()).data).toEqual({ externalId: '3328' });
    const list = (await (await LIST(new Request('http://x/'))).json()).data;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ externalSource: 'rawg', externalId: '3328', title: 'The Witcher 3', coverUrl: null });
    expect(list.ttlDays).toBe(30);
    expect((await del('3328')).status).toBe(200);
    expect((await del('3328')).status).toBe(200);
    expect((await (await LIST(new Request('http://x/'))).json()).data.items).toEqual([]);
  });

  it('DELETE: некорректный id и Origin = 400', async () => {
    expect((await del('a b')).status).toBe(400);
    expect((await del('3328', evil)).status).toBe(400);
  });

  it('503 для POST/DELETE/GET dislikes без БД', async () => {
    holder.db = null;
    expect((await post(valid)).status).toBe(503);
    expect((await del('1')).status).toBe(503);
    const r = await LIST(new Request('http://x/'));
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toMatch(/SECRETPASS|postgres:/);
  });
});
