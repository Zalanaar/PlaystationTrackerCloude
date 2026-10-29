import { describe, expect, it } from 'vitest';
import { parseDislikeBody, parseGameId, parseTime } from '@/server/recommend/validation';
import { GET } from './route';
import { POST } from './dislike/route';
import { DELETE } from './dislike/[gameId]/route';

const json = { 'content-type': 'application/json' };
const evil = { ...json, origin: 'http://evil.example', host: 'x' };
const req = (method: string, body: unknown, headers: Record<string, string> = json) =>
  new Request('http://x/api/recommend/dislike', { method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const params = (gameId: string) => ({ params: Promise.resolve({ gameId }) });
const code = async (r: Response) => (await r.json()).error.code;

// Валидация идёт до обращения к БД: тесты не требуют DATABASE_URL.
describe('валидаторы «Подскажи»', () => {
  it('parseTime', () => {
    expect(parseTime(null)).toEqual({ ok: true, value: 'any' });
    for (const v of ['any', 'short', 'medium', 'long']) expect(parseTime(v)).toEqual({ ok: true, value: v });
    for (const v of ['', 'ANY', 'fast', ' short', 'short,long']) expect(parseTime(v).ok, v).toBe(false);
  });
  it('parseDislikeBody', () => {
    expect(parseDislikeBody({ gameId: 41 })).toEqual({ ok: true, value: 41 });
    for (const b of [{}, { gameId: 0 }, { gameId: -1 }, { gameId: 1.5 }, { gameId: '41' }, { gameId: null }, { gameId: 2_147_483_648 }, { gameId: 1, extra: 1 }, [], null, 'x'])
      expect(parseDislikeBody(b).ok, JSON.stringify(b)).toBe(false);
  });
  it('parseGameId', () => {
    expect(parseGameId('41')).toBe(41);
    for (const v of ['0', '-1', 'abc', '1.5', '', '99999999999', '2147483648', '1e3']) expect(parseGameId(v), v).toBeNull();
  });
});

describe('валидация API «Подскажи» (без БД)', () => {
  it('GET: неверный time = 400 invalid_request', async () => {
    for (const q of ['time=fast', 'time=', 'time=SHORT']) {
      const r = await GET(new Request(`http://x/api/recommend?${q}`));
      expect(r.status, q).toBe(400);
      expect(await code(r)).toBe('invalid_request');
    }
  });
  it('POST dislike: тело, Content-Type, Origin', async () => {
    for (const b of [{}, { gameId: 0 }, { gameId: '1' }, { gameId: 1, x: 1 }, '{bad', []]) expect((await POST(req('POST', b))).status, JSON.stringify(b)).toBe(400);
    expect((await POST(req('POST', { gameId: 1 }, {}))).status).toBe(400);
    expect((await POST(req('POST', { gameId: 1 }, evil))).status).toBe(400);
    expect(await code(await POST(req('POST', { gameId: 1 }, evil)))).toBe('invalid_request');
  });
  it('DELETE dislike/{gameId}: id и Origin', async () => {
    for (const id of ['abc', '0', '-5', '1.5']) expect((await DELETE(req('DELETE', ''), params(id))).status, id).toBe(400);
    expect((await DELETE(req('DELETE', '', evil), params('1'))).status).toBe(400);
  });
});
