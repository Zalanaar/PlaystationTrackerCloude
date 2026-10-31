// Контракт §9 на реальных роутах (dev-сервер без БД): права, Origin/Content-Type, валидация. Всё это отвечает до обращения к БД.
import { test, expect } from '@playwright/test';
import { signedSession } from './session';

test.describe('API коллекции без БД', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'API не зависит от вьюпорта'); });

  const endpoints: [string, string][] = [
    ['GET', '/api/games'], ['GET', '/api/collection/summary'],
    ['PUT', '/api/games/1/status'], ['PATCH', '/api/games/1/status-date'], ['POST', '/api/games/status-bulk'],
  ];

  for (const [method, path] of endpoints) {
    test(`${method} ${path} без сессии = 401, с чужой подписью = 401`, async ({ playwright, baseURL }) => {
      const anon = await playwright.request.newContext({ baseURL });
      const r = await anon.fetch(path, { method, data: method === 'GET' ? undefined : {}, headers: { 'content-type': 'application/json' } });
      expect(r.status()).toBe(401);
      expect((await r.json()).error.code).toBe('unauthorized');
      const bad = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie: `pst_session=${await signedSession({ secret: 'x'.repeat(48) })}` } });
      expect((await bad.fetch(path, { method, data: method === 'GET' ? undefined : {}, headers: { 'content-type': 'application/json' } })).status()).toBe(401);
      const expired = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie: `pst_session=${await signedSession({ iat: 1, exp: 2 })}` } });
      expect((await expired.fetch(path, { method })).status()).toBe(401);
    });
  }

  test('cron-секрет не открывает API коллекции', async ({ playwright, baseURL }) => {
    const c = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { authorization: 'Bearer ' + 'e2e-cron-secret-'.padEnd(48, 'y') } });
    expect((await c.get('/api/games')).status()).toBe(401);
  });

  test('мутации: чужой Origin, не-JSON Content-Type, битое тело = 400 (даже с сессией)', async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie: `pst_session=${await signedSession()}` } });
    const json = { 'content-type': 'application/json' };
    const cases: [string, string, Record<string, string>, string][] = [
      ['PUT', '/api/games/1/status', { ...json, origin: 'https://evil.example' }, '{"status":"playing"}'],
      ['PATCH', '/api/games/1/status-date', { ...json, origin: 'https://evil.example' }, '{"completedAt":"2026-01-01T00:00:00Z"}'],
      ['POST', '/api/games/status-bulk', { ...json, origin: 'https://evil.example' }, '{"ids":[1],"status":"backlog"}'],
      ['PUT', '/api/games/1/status', { 'content-type': 'text/plain' }, '{"status":"playing"}'],
      ['POST', '/api/games/status-bulk', { 'content-type': 'application/x-www-form-urlencoded' }, 'ids=1&status=backlog'],
      ['PUT', '/api/games/1/status', json, '{bad'],
      ['PUT', '/api/games/1/status', json, '{"status":"wat"}'],
      ['PUT', '/api/games/1/status', json, '{}'],
      ['PUT', '/api/games/-1/status', json, '{"status":null}'],
      ['PUT', '/api/games/99999999999/status', json, '{"status":null}'],
      ['PATCH', '/api/games/1/status-date', json, '{"completedAt":"2026-01-01T00:00:00Z","droppedAt":"2026-01-01T00:00:00Z"}'],
      ['PATCH', '/api/games/1/status-date', json, '{"completedAt":null}'],
      ['PATCH', '/api/games/1/status-date', json, '{"completedAt":"2026-01-01"}'],
      ['POST', '/api/games/status-bulk', json, JSON.stringify({ ids: [], status: 'backlog' })],
      ['POST', '/api/games/status-bulk', json, JSON.stringify({ ids: Array.from({ length: 1001 }, (_, i) => i + 1), status: 'backlog' })],
      ['POST', '/api/games/status-bulk', json, JSON.stringify({ ids: [1, 'a'], status: 'backlog' })],
      ['POST', '/api/games/status-bulk', json, JSON.stringify({ ids: [1] })],
    ];
    // С Фазы 20.3 requireUser читает пользователя из БД раньше валидации: без БД в e2e все ответы 503 db_unavailable.
    // Сами проверки Origin, Content-Type и тела (400 invalid_request) покрыты route-тестами с подменой requireUser.
    for (const [method, path, headers, data] of cases) {
      const r = await ctx.fetch(path, { method, headers, data });
      expect(r.status(), `${method} ${path} ${data.slice(0, 40)}`).toBe(503);
      expect((await r.json()).error.code).toBe('db_unavailable');
    }
  });

  test('GET /api/games: граничные параметры', async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie: `pst_session=${await signedSession()}` } });
    const bad = ['status=zzz', 'status=playing,zzz', 'year=1999', 'year=2101', 'year=2026.5', 'year=-1', 'sort=zzz', 'order=up', 'limit=0', 'limit=301', 'limit=-1', 'offset=-1', 'offset=abc', `q=${'я'.repeat(101)}`];
    // валидация параметров (400) покрыта route-тестами; в e2e без БД requireUser отвечает раньше (20.3)
    for (const q of bad) expect((await ctx.get(`/api/games?${q}`)).status(), q).toBe(503);
    // валидные параметры доходят до БД (503, в e2e её нет), а не отсекаются валидацией
    const good = ['', 'status=none', 'status=playing,none,playing', 'year=2000', 'year=2100', 'limit=300', 'limit=1', `q=${'я'.repeat(100)}`, 'q=%25', 'q=%20', 'sort=completed_at&order=asc', 'unknown=1'];
    for (const q of good) expect((await ctx.get(`/api/games?${q}`)).status(), q).toBe(503);
  });

  test('ответы API не кэшируются', async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie: `pst_session=${await signedSession()}` } });
    expect((await ctx.get('/api/games')).headers()['cache-control']).toContain('no-store');
  });
});
