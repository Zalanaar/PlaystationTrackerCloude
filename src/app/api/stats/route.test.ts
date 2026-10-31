import { describe, expect, it, vi } from 'vitest';
import { GET } from './route';

vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

describe('GET /api/stats: валидация (без БД)', () => {
  it('мусорные параметры = 400 invalid_request', async () => {
    for (const q of ['period=week', 'year=x', 'period=month', 'period=month&month=13']) {
      const r = await GET(new Request(`http://x/api/stats?${q}`));
      expect(r.status, q).toBe(400);
      expect((await r.json()).error.code).toBe('invalid_request');
    }
  });
  it('сбой БД = 503 db_unavailable', async () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const r = await GET(new Request('http://x/api/stats'));
    if (prev !== undefined) process.env.DATABASE_URL = prev;
    expect(r.status).toBe(503);
    expect((await r.json()).error.code).toBe('db_unavailable');
  });
});
