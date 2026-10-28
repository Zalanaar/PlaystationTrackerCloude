import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/wrapped: валидация (без БД)', () => {
  it('мусорный год = 400 invalid_request', async () => {
    for (const q of ['year=x', 'year=1999', 'year=2101']) {
      const r = await GET(new Request(`http://x/api/wrapped?${q}`));
      expect(r.status, q).toBe(400);
      expect((await r.json()).error.code).toBe('invalid_request');
    }
  });
  it('сбой БД = 503 db_unavailable', async () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const r = await GET(new Request('http://x/api/wrapped?year=2026'));
    if (prev !== undefined) process.env.DATABASE_URL = prev;
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe('db_unavailable');
  });
});
