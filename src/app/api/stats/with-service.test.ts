import { describe, expect, it, vi } from 'vitest';
import { GET as wrappedGet } from '../wrapped/route';
import { GET } from './route';

vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

// Контракт 20.8: неверный withService = 400 до обращения к БД.
describe('withService в /api/stats и /api/wrapped', () => {
  it('stats: неверное значение = 400 invalid_request', async () => {
    for (const q of ['withService=yes', 'withService=', 'withService=2']) {
      const r = await GET(new Request(`http://x/api/stats?period=year&${q}`));
      expect(r.status, q).toBe(400);
      expect((await r.json()).error.code).toBe('invalid_request');
    }
  });
  it('wrapped: неверное значение = 400', async () => {
    const r = await wrappedGet(new Request('http://x/api/wrapped?year=2026&withService=maybe'));
    expect(r.status).toBe(400);
  });
});
