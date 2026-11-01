import { describe, expect, it, vi } from 'vitest';
import { DELETE, PUT } from './route';

vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

const json = { 'content-type': 'application/json' };
const evil = { ...json, origin: 'http://evil.example', host: 'x' };
const req = (method: string, body: unknown, headers: Record<string, string> = json) =>
  new Request('http://x/api/roadmap/goal', { method, headers, body: method === 'DELETE' ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });

// Валидация идёт до обращения к БД: тесты не требуют DATABASE_URL.
describe('валидация API цели года (17.3a, без БД)', () => {
  it('PUT: невалидные тела, нет Content-Type, чужой Origin = 400', async () => {
    const bads: unknown[] = [{}, { mode: 'complete', count: 0 }, { mode: 'zzz', count: 3 }, { mode: 'complete', count: '3' }, { mode: 'complete', count: 2.5 },
      { mode: 'backlog_to', count: -1 }, { mode: 'complete', count: 5, year: 2026 }, '{bad', []];
    for (const b of bads) expect((await PUT(req('PUT', b))).status, JSON.stringify(b)).toBe(400);
    expect((await PUT(req('PUT', { mode: 'complete', count: 5 }, {}))).status).toBe(400);
    expect((await PUT(req('PUT', { mode: 'complete', count: 5 }, evil))).status).toBe(400);
  });
  it('DELETE: чужой Origin = 400', async () => {
    expect((await DELETE(req('DELETE', null, evil))).status).toBe(400);
  });
});
