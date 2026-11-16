import { describe, expect, it, vi } from 'vitest';
import { GET } from './route';

vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

describe('GET /api/wrapped/share: валидация (без БД)', () => {
  it('мусорный год и «всё время» = 400 invalid_request', async () => {
    for (const q of ['year=x', 'year=1999', 'year=all', 'year=2101']) {
      const r = await GET(new Request(`http://x/api/wrapped/share?${q}`));
      expect(r.status, q).toBe(400);
      expect((await r.json()).error.code).toBe('invalid_request');
    }
  });
  it('сбой БД = 503, картинка не рисуется', async () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const r = await GET(new Request('http://x/api/wrapped/share?year=2026'));
    if (prev !== undefined) process.env.DATABASE_URL = prev;
    expect(r.status).toBe(503);
  });
});
