// QA Ф30: мусор в POST/DELETE «Не интересно», GET без сети.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { resetTestSession } from '@/server/auth/test-require-user';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => holder.db }));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

import { DELETE } from './dislike/[externalId]/route';
import { POST } from './dislike/route';
import { GET } from './route';

const json = { 'content-type': 'application/json' };
const post = (body: string, headers: Record<string, string> = json) => POST(new Request('http://x/api/recommend/discover/dislike', { method: 'POST', headers, body }));
const del = (id: string) => DELETE(new Request('http://x/api/recommend/discover/dislike/x', { method: 'DELETE' }), { params: Promise.resolve({ externalId: id }) });
const ok = { externalSource: 'rawg', externalId: '1', title: 'T', coverUrl: null };

describe('QA Ф30: роуты', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); holder.db = t.db; resetTestSession(); vi.stubEnv('RAWG_API_KEY', 'k'); });

  it.each([
    ['null', 'null'], ['массив', '[]'], ['число', '5'], ['строка', '"x"'], ['не JSON', '{'], ['пустое тело', ''],
    ['чужой источник', JSON.stringify({ ...ok, externalSource: 'steam' })],
    ['лишнее поле', JSON.stringify({ ...ok, userId: 2 })],
    ['id с пробелом', JSON.stringify({ ...ok, externalId: 'a b' })],
    ['id с /', JSON.stringify({ ...ok, externalId: '../x' })],
    ['id 65 символов', JSON.stringify({ ...ok, externalId: 'a'.repeat(65) })],
    ['id число', JSON.stringify({ ...ok, externalId: 1 })],
    ['title пустой', JSON.stringify({ ...ok, title: '   ' })],
    ['title 201', JSON.stringify({ ...ok, title: 'a'.repeat(201) })],
    ['cover http', JSON.stringify({ ...ok, coverUrl: 'http://a/b.jpg' })],
    ['cover javascript', JSON.stringify({ ...ok, coverUrl: 'javascript:alert(1)' })],
    ['cover нет', JSON.stringify({ externalSource: 'rawg', externalId: '1', title: 'T' })],
  ])('POST %s = 400, в БД ничего', async (_n, body) => {
    const r = await post(body);
    expect(r.status).toBe(400);
    expect(await t.db.select().from(schema.recommendExternalDislikes)).toHaveLength(0);
  });
  it('POST без content-type json и с чужим Origin = 4xx', async () => {
    expect((await post(JSON.stringify(ok), { 'content-type': 'text/plain' })).status).toBeGreaterThanOrEqual(400);
    expect((await post(JSON.stringify(ok), { ...json, origin: 'http://evil.example', host: 'x' })).status).toBeGreaterThanOrEqual(400);
    expect(await t.db.select().from(schema.recommendExternalDislikes)).toHaveLength(0);
  });
  it('POST валидный дважды: одна строка; DELETE мусора = 400, DELETE чужого/несуществующего = 200', async () => {
    expect((await post(JSON.stringify(ok))).status).toBe(200);
    expect((await post(JSON.stringify(ok))).status).toBe(200);
    expect(await t.db.select().from(schema.recommendExternalDislikes)).toHaveLength(1);
    for (const bad of ['a b', 'a%2Fb', 'a/b', '', 'x'.repeat(65), "1'; DROP TABLE games;--"]) expect((await del(bad)).status).toBe(400);
    expect((await del('999')).status).toBe(200);
    expect(await t.db.select().from(schema.recommendExternalDislikes)).toHaveLength(1);
    expect((await del('1')).status).toBe(200);
    expect(await t.db.select().from(schema.recommendExternalDislikes)).toHaveLength(0);
  });
  it('GET не обращается к сети', async () => {
    const f = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', f);
    const r = await GET(new Request('http://x/api/recommend/discover?refresh=1&force=1'));
    expect(r.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
