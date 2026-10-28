import { describe, expect, it } from 'vitest';
import { GET } from './route';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string) => GET(new Request(`http://x/api/games/${id}`), params(id));

describe('GET /api/games/{id}', () => {
  it('id не положительное целое = 400 invalid_request', async () => {
    for (const id of ['abc', '0', '-1', '1.5', '']) {
      const r = await get(id);
      expect(r.status, id).toBe(400);
      expect((await r.json()).error.code).toBe('invalid_request');
    }
  });
  it('сбой БД = 503 db_unavailable', async () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const r = await get('1');
    if (prev !== undefined) process.env.DATABASE_URL = prev;
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe('db_unavailable');
  });
});
