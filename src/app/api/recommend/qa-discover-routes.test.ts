// QA 13b: API discover/dislike (контракт 19.7): валидация coverUrl и полей, Origin/Content-Type, идемпотентность, TTL, 503.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
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

import { DELETE } from './discover/dislike/[externalId]/route';
import { POST } from './discover/dislike/route';
import { GET as LIST } from './discover/dislikes/route';

vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

const json = { 'content-type': 'application/json' };
const post = (body: unknown, headers: Record<string, string> = json) =>
  POST(new Request('http://x/api/recommend/discover/dislike', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));
const del = (id: string, headers: Record<string, string> = {}) =>
  DELETE(new Request('http://x/api/recommend/discover/dislike/' + encodeURIComponent(id), { method: 'DELETE', headers }), { params: Promise.resolve({ externalId: id }) });
const ok = { externalSource: 'rawg', externalId: '3328', title: 'The Witcher 3', coverUrl: 'https://media.rawg.io/a.jpg' };

describe('QA 13b: discover dislike API', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); holder.db = t.db; });

  it.each([
    ['http', 'http://media.rawg.io/a.jpg'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:image/png;base64,AAAA'],
    ['file', 'file:///etc/passwd'],
    ['protocol-relative', '//evil.example/a.png'],
    ['HTTPS верхний регистр', 'HTTPS://x.example/a.png'],
    ['пробел впереди', ' https://x.example/a.png'],
    ['длиннее 2048', 'https://x.example/' + 'a'.repeat(2040)],
    ['не строка', 5],
    ['undefined (поле обязательно)', undefined],
  ])('coverUrl %s -> 400', async (_n, coverUrl) => {
    const r = await post({ ...ok, coverUrl });
    expect(r.status).toBe(400);
  });

  it('coverUrl null и https проходят; запись сохраняется как есть', async () => {
    expect((await post({ ...ok, coverUrl: null })).status).toBe(200);
    expect((await post({ ...ok, externalId: '2' })).status).toBe(200);
    const list = (await (await LIST(new Request('http://x/'))).json()).data;
    expect(list.items.map((i: { coverUrl: string | null }) => i.coverUrl).sort()).toEqual(['https://media.rawg.io/a.jpg', null]);
  });

  it('фиксация: https:// с пустым хостом и внутренние хосты принимаются (сервер URL не запрашивает, SSRF нет)', async () => {
    expect((await post({ ...ok, externalId: 'a', coverUrl: 'https://' })).status).toBe(200);
    expect((await post({ ...ok, externalId: 'b', coverUrl: 'https://169.254.169.254/latest/meta-data' })).status).toBe(200);
  });

  it.each([
    ['externalSource xbox', { externalSource: 'xbox' }],
    ['externalId пустой', { externalId: '' }],
    ['externalId с пробелом', { externalId: 'a b' }],
    ['externalId со слэшем', { externalId: 'a/b' }],
    ['externalId с %', { externalId: 'a%2e' }],
    ['externalId 65 символов', { externalId: 'a'.repeat(65) }],
    ['title пустой', { title: '   ' }],
    ['title 201', { title: 'a'.repeat(201) }],
    ['лишнее поле', { extra: 1 }],
    ['id числом', { externalId: 3328 }],
  ])('%s -> 400', async (_n, patch) => {
    expect((await post({ ...ok, ...patch })).status).toBe(400);
  });

  it('Origin и Content-Type', async () => {
    expect((await post(ok, { ...json, origin: 'http://evil.example', host: 'x' })).status).toBe(400);
    expect((await post(ok, { ...json, origin: 'null', host: 'x' })).status).toBe(400);
    expect((await post(ok, { 'content-type': 'text/plain' })).status).toBe(400);
    expect((await post(ok, {})).status).toBe(400);
    expect((await post('{bad', json)).status).toBe(400);
    expect((await post(ok, { ...json, origin: 'http://x', host: 'x' })).status).toBe(200);
    expect((await del('3328', { origin: 'http://evil.example', host: 'x' })).status).toBe(400);
  });

  it('идемпотентность: повтор POST = одна строка, TTL продлевается; DELETE повторный 200', async () => {
    const { recommendExternalDislikes: tb } = schema;
    await post(ok);
    await t.db.update(tb).set({ createdAt: new Date(Date.now() - 29 * 86_400_000) }).where(eq(tb.externalId, '3328'));
    expect((await post({ ...ok, title: 'Новое имя' })).status).toBe(200);
    const rows = await t.db.select().from(tb);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Новое имя');
    expect(Date.now() - rows[0].createdAt.getTime()).toBeLessThan(60_000);
    expect((await del('3328')).status).toBe(200);
    expect((await del('3328')).status).toBe(200);
    expect((await del('nonexistent')).status).toBe(200);
    expect(await t.db.select().from(tb)).toHaveLength(0);
  });

  it('TTL: истёкшая отметка не в списке; граница 30 суток', async () => {
    const { recommendExternalDislikes: tb } = schema;
    const d = 86_400_000;
    await t.db.insert(tb).values([
      { externalSource: 'rawg', externalId: 'old', title: 'Old', createdAt: new Date(Date.now() - 30 * d - 1000) },
      { externalSource: 'rawg', externalId: 'fresh', title: 'Fresh', createdAt: new Date(Date.now() - 29 * d) },
    ]);
    const data = (await (await LIST(new Request('http://x/'))).json()).data;
    expect(data.items.map((i: { externalId: string }) => i.externalId)).toEqual(['fresh']);
    expect(data.ttlDays).toBe(30);
  });

  it('DELETE: служебные id -> 400; 503 без БД не раскрывает строку подключения', async () => {
    expect((await del('a b')).status).toBe(400);
    expect((await del('%00')).status).toBe(400);
    holder.db = null;
    for (const r of [await post(ok), await del('1'), await LIST(new Request('http://x/'))]) {
      expect(r.status).toBe(503);
      const text = JSON.stringify(await r.json());
      expect(text).toContain('db_unavailable');
      expect(text).not.toMatch(/SECRETPASS|postgres/);
    }
  });
});
