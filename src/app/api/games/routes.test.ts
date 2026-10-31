import { describe, expect, it, vi } from 'vitest';
import { GET as listGet } from './route';
import { POST as bulkPost } from './status-bulk/route';
import { PUT as statusPut } from './[id]/status/route';
import { PATCH as datePatch } from './[id]/status-date/route';
import { PUT as hiddenPut } from './[id]/hidden/route';
import { POST as resetAllPost } from './status-reset-all/route';
import { POST as restorePost } from './status-restore/route';

vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

const json = { 'content-type': 'application/json' };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body: unknown, headers: Record<string, string> = json) =>
  new Request('http://x/api/games', { method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const code = async (r: Response) => (await r.json()).error.code;

// Валидация идёт до обращения к БД: тесты не требуют DATABASE_URL.
describe('валидация API коллекции (без БД)', () => {
  it('GET /api/games: мусорные параметры = 400', async () => {
    for (const q of ['status=zzz', 'year=x', 'sort=zzz', 'limit=0', 'hidden=yes', 'hidden=1']) {
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

  it('POST status-bulk: лимит 1000, пустой, статус', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => i + 1);
    expect((await bulkPost(req('POST', { ids, status: 'backlog' }))).status).toBe(400);
    expect((await bulkPost(req('POST', { ids: [], status: 'backlog' }))).status).toBe(400);
    expect((await bulkPost(req('POST', { ids: [1], status: 'x' }))).status).toBe(400);
    expect((await bulkPost(req('POST', { ids: [1], status: 'x' }, {}))).status).toBe(400);
  });

  it('PUT hidden: id, тело, boolean', async () => {
    expect((await hiddenPut(req('PUT', { hidden: true }), params('x'))).status).toBe(400);
    expect((await hiddenPut(req('PUT', {}), params('1'))).status).toBe(400);
    expect((await hiddenPut(req('PUT', { hidden: 'true' }), params('1'))).status).toBe(400);
    expect((await hiddenPut(req('PUT', { hidden: null }), params('1'))).status).toBe(400);
    expect((await hiddenPut(req('PUT', { hidden: true }, {}), params('1'))).status).toBe(400);
    expect((await hiddenPut(req('PUT', { hidden: true }, { ...json, origin: 'http://evil.example', host: 'x' }), params('1'))).status).toBe(400);
  });

  it('POST status-reset-all: только {"confirm":"RESET"}', async () => {
    for (const b of [{}, { confirm: 'reset' }, { confirm: true }, '{bad', []]) {
      const r = await resetAllPost(req('POST', b));
      expect(r.status, JSON.stringify(b)).toBe(400);
      expect(await code(r)).toBe('invalid_request');
    }
    expect((await resetAllPost(req('POST', { confirm: 'RESET' }, {}))).status).toBe(400);
  });

  it('POST status-restore: backupId положительное целое', async () => {
    for (const b of [{}, { backupId: 0 }, { backupId: -1 }, { backupId: 1.5 }, { backupId: '1' }]) {
      expect((await restorePost(req('POST', b))).status, JSON.stringify(b)).toBe(400);
    }
  });
});

describe('Фаза 11: валидация длительности и фильтров (без БД)', () => {
  it('GET /api/games: мусорные genres/duration = 400', async () => {
    for (const q of ['genres=nope', 'duration=1_2', 'duration=lt10,zzz']) {
      const r = await listGet(new Request(`http://x/api/games?${q}`));
      expect(r.status, q).toBe(400);
    }
  });

  it('PATCH duration: id, Content-Type, Origin, тело', async () => {
    const { PATCH } = await import('./[id]/duration/route');
    expect((await PATCH(req('PATCH', { hours: 5 }), params('abc'))).status).toBe(400);
    expect((await PATCH(req('PATCH', { hours: 5 }, {}), params('1'))).status).toBe(400);
    expect((await PATCH(req('PATCH', { hours: 5 }, { ...json, origin: 'http://evil.example', host: 'x' }), params('1'))).status).toBe(400);
    expect((await PATCH(req('PATCH', '{bad'), params('1'))).status).toBe(400);
    for (const body of [{}, { hours: 0 }, { hours: -3 }, { hours: '5' }, { hours: 1001 }, { hours: true }]) {
      expect((await PATCH(req('PATCH', body), params('1'))).status, JSON.stringify(body)).toBe(400);
    }
  });
});
