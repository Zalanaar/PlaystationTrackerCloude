import { test, expect } from '@playwright/test';
import { signedSession } from './session';

const REQUIRED = ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'x-frame-options', 'permissions-policy', 'strict-transport-security', 'cross-origin-opener-policy', 'cross-origin-resource-policy'];

test('заголовки безопасности на странице, /login, /api (в т.ч. 401) и manifest', async ({ request, baseURL }) => {
  for (const path of ['/login', '/api/auth/me', '/manifest.webmanifest', '/icon.svg', '/']) {
    const res = await request.get(path, { maxRedirects: 0 });
    for (const h of REQUIRED) expect(res.headers()[h], `${path}: ${h}`).toBeTruthy();
    expect(res.headers()['x-frame-options']).toBe('DENY');
    expect(res.headers()['x-powered-by'], `${path}: x-powered-by`).toBeUndefined();
  }
  const m = await request.get('/manifest.webmanifest');
  expect(m.status()).toBe(200);
  void baseURL;
});

test('страницы грузятся без нарушений CSP', async ({ page, context, baseURL }) => {
  const violations: string[] = [];
  page.on('console', (m) => { if (/content security policy|violates the following/i.test(m.text())) violations.push(m.text()); });
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await page.goto('/');
  // D-P2: на мобильном вместо логотипа название раздела
  await expect(page.locator('.ps-header').getByText(/^(PS TRACKER|Коллекция)$/).filter({ visible: true }).first()).toBeVisible();
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000); // networkidle в dev не наступает (HMR, запросы к API без БД)
  expect(violations).toEqual([]);
});

test('script-src на nonce: без unsafe-inline, nonce свой на запрос и совпадает с nonce inline-скриптов', async ({ request }) => {
  const seen = new Set<string>();
  for (let i = 0; i < 2; i++) {
    const res = await request.get('/login');
    const csp = res.headers()['content-security-policy'];
    const script = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(script).not.toContain("'unsafe-inline'");
    const nonce = /'nonce-([^']+)'/.exec(script)![1];
    seen.add(nonce);
    const html = await res.text();
    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>/g)].map((m) => m[1]);
    expect(inline.length).toBeGreaterThan(0);
    for (const attrs of inline) expect(attrs, 'inline-скрипт без nonce').toContain(`nonce="${nonce}"`);
  }
  expect(seen.size).toBe(2);
});

test('тема из cookie и theme-script работают под nonce CSP (нет нарушений, data-theme применяется)', async ({ page, context, baseURL }) => {
  const violations: string[] = [];
  page.on('console', (m) => { if (/content security policy|violates the following/i.test(m.text())) violations.push(m.text()); });
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await page.addInitScript(() => localStorage.setItem('ps-theme', 'ps3'));
  await page.goto('/');
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000); // networkidle в dev не наступает (HMR, запросы к API без БД)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ps3');
  expect(violations).toEqual([]);
});
