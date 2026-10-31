// QA Фазы 13: маршруты «Подскажи» на PGlite (200/404/503, идемпотентность, Origin/Content-Type, утечки).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('postgres://user:SECRETPASS@host/db unreachable');
    return holder.db;
  },
}));

import { GET } from './route';
import { POST } from './dislike/route';
import { DELETE } from './dislike/[gameId]/route';

vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

const json = { 'content-type': 'application/json' };
const post = (body: unknown, h: Record<string, string> = json) => new Request('http://x/api/recommend/dislike', { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) });
const del = (h: Record<string, string> = {}) => new Request('http://x/api/recommend/dislike/1', { method: 'DELETE', headers: h });
const params = (gameId: string) => ({ params: Promise.resolve({ gameId }) });

describe('маршруты «Подскажи» на БД', () => {
  let t: TestDb;
  let gid = 0;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    holder.db = t.db;
    const [g] = await t.db.insert(schema.games).values({ category: 'ps5_native_game', lastSeenAt: new Date(), titleId: 'A', name: 'Alpha', psnGenres: ['ACTION'] }).returning({ id: schema.games.id });
    gid = g.id;
    await t.db.insert(schema.gameStatus).values({ gameId: gid, status: 'backlog', statusChangedAt: new Date() });
  });

  it('GET: конверт, время по умолчанию any, дизлайк убирает игру, повтор безопасен', async () => {
    const r = await GET(new Request('http://x/api/recommend'));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.ok).toBe(true);
    expect(b.data.meta).toMatchObject({ time: 'any', candidates: 1, llm: 'disabled' });
    for (let i = 0; i < 2; i++) {
      const p = await POST(post({ gameId: gid }));
      expect(p.status).toBe(200);
      expect((await p.json()).data).toEqual({ gameId: gid });
    }
    expect(await t.db.select().from(schema.recommendDislikes)).toHaveLength(1);
    expect((await (await GET(new Request('http://x/api/recommend?time=long'))).json()).data).toMatchObject({ items: [], meta: { candidates: 0, time: 'long' } });
    for (let i = 0; i < 2; i++) {
      const d = await DELETE(del(), params(String(gid)));
      expect(d.status).toBe(200);
    }
    expect(await t.db.select().from(schema.recommendDislikes)).toHaveLength(0);
  });
  it('404: нет такой игры (POST и DELETE), 400 на мусорный id, нет утечки текста', async () => {
    const p = await POST(post({ gameId: 999999 }));
    expect(p.status).toBe(404);
    expect((await p.json()).error.code).toBe('not_found');
    expect((await DELETE(del(), params('999999'))).status).toBe(404);
    expect((await DELETE(del(), params('1; DROP TABLE games'))).status).toBe(400);
  });
  it('Origin: чужой отклоняется на всех мутациях, свой и отсутствующий проходят; Content-Type только json', async () => {
    const own = { ...json, origin: 'http://x', host: 'x' };
    expect((await POST(post({ gameId: gid }, own))).status).toBe(200);
    expect((await POST(post({ gameId: gid }, { ...json, origin: 'null' }))).status).toBe(400);
    expect((await POST(post({ gameId: gid }, { ...json, origin: 'http://x.evil.com', host: 'x' }))).status).toBe(400);
    expect((await POST(post({ gameId: gid }, { 'content-type': 'text/plain' }))).status).toBe(400);
    expect((await POST(post({ gameId: gid }, { 'content-type': 'application/json; charset=utf-8' }))).status).toBe(200);
    expect((await DELETE(del({ origin: 'http://evil.example', host: 'x' }), params(String(gid)))).status).toBe(400);
    expect(await t.db.select().from(schema.recommendDislikes)).toHaveLength(1); // чужой DELETE ничего не снял
  });
  it('503 без БД: код db_unavailable, текст ошибки (строка подключения) не утекает', async () => {
    holder.db = null;
    for (const r of [await GET(new Request('http://x/api/recommend')), await POST(post({ gameId: 1 })), await DELETE(del(), params('1'))]) {
      expect(r.status).toBe(503);
      const text = JSON.stringify(await r.json());
      expect(text).toContain('db_unavailable');
      expect(text).not.toMatch(/SECRETPASS|postgres:/);
    }
  });
  it('GET: повторяющийся/лишний time и мусор', async () => {
    expect((await GET(new Request('http://x/api/recommend?time=short&time=bogus'))).status).toBe(200); // берётся первое значение
    for (const q of ['time=%00', 'time=any%20', 'time=1', 'time=null']) expect((await GET(new Request(`http://x/api/recommend?${q}`))).status, q).toBe(400);
    expect((await GET(new Request('http://x/api/recommend?foo=bar'))).status).toBe(200);
  });
  it('ответ GET не содержит служебных полей (topGenre, ключи, env)', async () => {
    const s = JSON.stringify(await (await GET(new Request('http://x/api/recommend'))).json());
    expect(s).not.toMatch(/topGenre|apiKey|LLM_API_KEY/);
  });
});
