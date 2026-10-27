import { describe, expect, it } from 'vitest';
import { GET as listGet } from './route';
import { POST as bulkPost } from './status-bulk/route';
import { PUT as statusPut } from './[id]/status/route';
import { PATCH as datePatch } from './[id]/status-date/route';

const json = { 'content-type': 'application/json' };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body: unknown, headers: Record<string, string> = json) =>
  new Request('http://x/api/games', { method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const code = async (r: Response) => (await r.json()).error.code;

// Валидация идёт до обращения к БД: тесты не требуют DATABASE_URL.
describe('валидация API коллекции (без БД)', () => {
  it('GET /api/games: мусорные параметры = 400', async () => {
    for (const q of ['status=zzz', 'year=x', 'sort=zzz', 'limit=0']) {
      const r = await listGet(new Request(`http://x/api/games?${q}`));
      expect(r.status, q).toBe(400);
      expect(await code(r)).toBe('invalid_request');
    }
  });

  it('PUT status: id, Content-Type, Origin, тело', async () => {
    expect((await statusPut(req('PUT', { status: 'playing' }), params('abc'))).status).toBe(400);
    expect((await statusPut(req('PUT', { status: 'playing' }, {}), params('1'))).status).toBe(400);
    expect((await statusPut(req('PUT', { status: 'playing' }, { ...json, origin: 'http://evil.example', host: 'x' }), params('1'))).status).toBe(400);
    expect((await statusPut(req('PUT', '{bad'), params('1'))).status).toBe(400);
    expect((await statusPut(req('PUT', { status: 'wat' }), params('1'))).status).toBe(400);
    expect((await statusPut(req('PUT', {}), params('1'))).status).toBe(400);
  });

  it('PATCH status-date: тело', async () => {
    expect((await datePatch(req('PATCH', {}), params('1'))).status).toBe(400);
    expect((await datePatch(req('PATCH', { completedAt: 'вчера' }), params('1'))).status).toBe(400);
    expect((await datePatch(req('PATCH', { completedAt: '2026-01-01T00:00:00Z' }), params('0'))).status).toBe(400);
  });

  it('POST status-bulk: лимит 250, пустой, статус', async () => {
    const ids = Array.from({ length: 251 }, (_, i) => i + 1);
    expect((await bulkPost(req('POST', { ids, status: 'backlog' }))).status).toBe(400);
    expect((await bulkPost(req('POST', { ids: [], status: 'backlog' }))).status).toBe(400);
    expect((await bulkPost(req('POST', { ids: [1], status: 'x' }))).status).toBe(400);
    expect((await bulkPost(req('POST', { ids: [1], status: 'x' }, {}))).status).toBe(400);
  });
});
