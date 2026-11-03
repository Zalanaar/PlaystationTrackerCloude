// QA Фазы 41: закрытый доступ и подмена pid на живом dev-сервере (БД недоступна: любой «успех» без БД означал бы обход проверки).
// Глубокие проверки IDOR/изоляции на PGlite: src/app/api/me/profiles/routes.test.ts, src/server/auth/session-profiles.test.ts.
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';
import { E2E_ENV } from './env';
import { signedSession } from './session';

const ORIGIN = 'http://localhost:3100';
function sign(payload: Record<string, unknown>, secret = E2E_ENV.SESSION_SECRET): string {
  const iat = Math.floor(Date.now() / 1000);
  const p = Buffer.from(JSON.stringify({ v: 2, uid: 1, role: 'owner', amr: 'pwd', iat, exp: iat + 3600, ...payload })).toString('base64url');
  return `${p}.${createHmac('sha256', secret).update(p).digest('base64url')}`;
}
const cookie = (v: string) => ({ cookie: `pst_session=${v}`, origin: ORIGIN, 'content-type': 'application/json' });
const WRITE: Array<[string, string, unknown]> = [
  ['POST', '/api/me/profiles', { onlineId: 'Some_Nick' }],
  ['POST', '/api/me/profiles/active', { profileId: 2 }],
  ['DELETE', '/api/me/profiles/2', { confirmOnlineId: 'x' }],
];

test.beforeEach(({}, i) => { test.skip(i.project.name !== 'desktop'); });

test('без cookie: профили закрыты (401), страница ведёт на вход', async ({ request }) => {
  for (const [m, url, body] of WRITE) {
    const r = await request.fetch(url, { method: m, data: body, headers: { origin: ORIGIN } });
    expect(r.status(), `${m} ${url}`).toBe(401);
  }
  expect((await request.get('/api/me/profiles')).status()).toBe(401);
  expect((await request.get('/api/auth/me')).status()).toBe(401);
  const page = await request.get('/profiles', { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(page.status());
  expect(page.headers().location).toContain('/login');
});

test('подмена pid без подписи и подпись чужим секретом: 401, cookie очищена или страница на вход', async ({ request }) => {
  const good = sign({ pid: 2 });
  const [pl, sig] = good.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(pl, 'base64url').toString()), pid: 999 })).toString('base64url');
  const bad = [`${forgedPayload}.${sig}`, sign({ pid: 2 }, 'x'.repeat(48)), sign({ pid: 0 }), sign({ pid: -5 }), sign({ pid: 1.5 }), sign({ pid: '2' })];
  for (const v of bad) {
    for (const url of ['/api/me/profiles', '/api/auth/me', '/api/collection/summary']) {
      const r = await request.get(url, { headers: cookie(v), maxRedirects: 0 });
      expect(r.status(), `${url} ${v.slice(0, 12)}`).toBe(401);
    }
    const page = await request.get('/profiles', { headers: cookie(v), maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(page.status());
  }
});

test('валидно подписанный pid без доступной БД не даёт данных (503/401, не 200)', async ({ request }) => {
  const v = sign({ pid: 2 });
  for (const url of ['/api/me/profiles', '/api/collection/summary', '/api/auth/me']) {
    const r = await request.get(url, { headers: cookie(v) });
    expect([401, 503], url).toContain(r.status());
    expect(await r.text()).not.toMatch(/psn_account_id|npsso|refresh/i);
  }
});

test('pid из query/тела не принимается как выбор профиля (без БД всё равно не 200)', async ({ request }) => {
  const v = await signedSession();
  for (const url of ['/api/collection/summary?pid=2', '/api/games?profileId=2&activeProfileId=2']) {
    const r = await request.get(url, { headers: cookie(v) });
    expect([401, 503], url).toContain(r.status());
  }
});

// CSRF (чужой Origin, не JSON) проверяется на PGlite: routes.test.ts «валидация, Origin, JSON, 401» (на dev без БД сессия отвечает 503 раньше Origin).

test('service worker не кэширует профили, /api и закрытые страницы', async () => {
  const sw = createRequire(import.meta.url)('../public/sw.js') as { classify: (r: { method: string; url: string; mode?: string }, origin: string) => string };
  for (const p of ['/api/me/profiles', '/api/me/profiles/active', '/api/auth/me', '/api/collection']) {
    expect(sw.classify({ method: 'GET', url: `${ORIGIN}${p}`, mode: 'cors' }, ORIGIN), p).toBe('bypass');
  }
  expect(sw.classify({ method: 'POST', url: `${ORIGIN}/api/me/profiles/active`, mode: 'cors' }, ORIGIN)).toBe('bypass');
  // навигация к /profiles: только сеть (при отказе заглушка /offline), в кэш не кладётся
  expect(sw.classify({ method: 'GET', url: `${ORIGIN}/profiles`, mode: 'navigate' }, ORIGIN)).toBe('navigate');
  expect(sw.classify({ method: 'GET', url: `${ORIGIN}/profiles?_rsc=1`, mode: 'cors' }, ORIGIN)).toBe('bypass');
});
