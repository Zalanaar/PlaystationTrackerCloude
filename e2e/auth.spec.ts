import { test, expect } from '@playwright/test';
import { E2E_ENV } from './env';
import { signedSession } from './session';

test.describe('закрытый сайт', () => {
  test('страница без cookie редиректит на /login?next=', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\?next=%2F$/);
    await expect(page.getByRole('link', { name: 'Войти через Google' })).toBeVisible();
    await page.getByText('Аварийный вход владельца').click();
    await expect(page.getByLabel('Пароль')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Войти по паролю' })).toBeVisible();
  });

  test('вложенный путь сохраняется в next', async ({ request }) => {
    const r = await request.get('/stats?year=2026', { maxRedirects: 0 });
    expect(r.status()).toBe(307);
    expect(r.headers()['location']).toContain('/login?next=%2Fstats%3Fyear%3D2026');
    expect(r.headers()['cache-control']).toBe('no-store');
  });

  test('закрытый /api отвечает 401 JSON без редиректа', async ({ request }) => {
    for (const p of ['/api/health', '/api/unknown']) {
      const r = await request.get(p, { maxRedirects: 0 });
      expect(r.status()).toBe(401);
      expect((await r.json()).error.code).toBe('unauthorized');
    }
  });

  test('подделанная и просроченная cookie не пускают', async ({ request }) => {
    const now = Math.floor(Date.now() / 1000);
    for (const v of [
      await signedSession({ secret: 'z'.repeat(48) }),
      await signedSession({ iat: now - 7200, exp: now - 3600 }),
      'garbage',
    ]) {
      const r = await request.get('/api/health', { headers: { cookie: `pst_session=${v}` }, maxRedirects: 0 });
      expect(r.status()).toBe(401);
    }
  });

  test('cron: без Bearer и с чужим 401', async ({ request }) => {
    expect((await request.get('/api/cron/sync', { maxRedirects: 0 })).status()).toBe(401);
    const bad = await request.get('/api/cron/sync', { headers: { authorization: 'Bearer nope' }, maxRedirects: 0 });
    expect(bad.status()).toBe(401);
    const ok = await request.get('/api/cron/sync', { headers: { authorization: `Bearer ${E2E_ENV.CRON_SECRET}` }, maxRedirects: 0 });
    // авторизация пройдена; синк упирается в недоступную БД e2e (503), а не в 401
    expect(ok.status()).toBe(503);
    expect((await ok.json()).error.code).toBe('db_unavailable');
  });

  test('валидная сессия: /api/health проходит авторизацию (БД в e2e недоступна, 503)', async ({ request }) => {
    const r = await request.get('/api/health', { headers: { cookie: `pst_session=${await signedSession()}` }, maxRedirects: 0 });
    expect(r.status()).toBe(503);
    expect((await r.json()).error.code).toBe('db_unavailable');
  });

  test('валидная сессия: /login редиректит на /', async ({ request }) => {
    const r = await request.get('/login', { headers: { cookie: `pst_session=${await signedSession()}` }, maxRedirects: 0 });
    expect(r.status()).toBe(307);
    expect(new URL(r.headers()['location'], 'http://x').pathname).toBe('/');
  });
});

test.describe('POST /api/auth/login', () => {
  const url = '/api/auth/login';

  test('чужой Origin отклоняется до проверки пароля', async ({ request }) => {
    const r = await request.post(url, {
      data: { password: E2E_ENV.ADMIN_PASSWORD },
      headers: { origin: 'https://evil.example' },
    });
    expect(r.status()).toBe(400);
    expect(r.headers()['set-cookie']).toBeUndefined();
  });

  test('не JSON Content-Type отклоняется', async ({ request }) => {
    const r = await request.post(url, { form: { password: E2E_ENV.ADMIN_PASSWORD } });
    expect(r.status()).toBe(400);
  });

  test('пустое/слишком длинное тело: 400', async ({ request }) => {
    expect((await request.post(url, { data: {} })).status()).toBe(400);
    expect((await request.post(url, { data: { password: 'x'.repeat(257) } })).status()).toBe(400);
  });

  test('при недоступной БД вход не выдаёт cookie даже с верным паролем (fail closed)', async ({ request }) => {
    const r = await request.post(url, { data: { password: E2E_ENV.ADMIN_PASSWORD } });
    expect(r.status()).toBe(503);
    expect(r.headers()['set-cookie']).toBeUndefined();
  });

  test('logout идемпотентен и очищает cookie', async ({ request }) => {
    const r = await request.post('/api/auth/logout', { headers: { 'content-type': 'application/json' }, data: {} });
    expect(r.status()).toBe(200);
    const sc = r.headers()['set-cookie'];
    expect(sc).toMatch(/pst_session=;/);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=lax/i);
    expect(sc).toMatch(/Max-Age=0/i);
  });
});

test.describe('logout: CSRF', () => {
  test('чужой Origin и не-JSON дают 400', async ({ request }) => {
    const a = await request.post('/api/auth/logout', { headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, data: {} });
    expect(a.status()).toBe(400);
    const b = await request.post('/api/auth/logout', { headers: { 'content-type': 'text/plain' }, data: 'x' });
    expect(b.status()).toBe(400);
  });
  test('/api/*.png без сессии закрыт (matcher)', async ({ request }) => {
    expect((await request.get('/api/anything.png')).status()).toBe(401);
  });
});
