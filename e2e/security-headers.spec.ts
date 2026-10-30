import { test, expect } from '@playwright/test';
import { signedSession } from './session';

const REQUIRED = ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'x-frame-options', 'permissions-policy', 'strict-transport-security'];

test('заголовки безопасности на странице, /login, /api (в т.ч. 401) и manifest', async ({ request, baseURL }) => {
  for (const path of ['/login', '/api/auth/me', '/manifest.webmanifest', '/icon.svg', '/']) {
    const res = await request.get(path, { maxRedirects: 0 });
    for (const h of REQUIRED) expect(res.headers()[h], `${path}: ${h}`).toBeTruthy();
    expect(res.headers()['x-frame-options']).toBe('DENY');
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
  await expect(page.getByRole('link', { name: 'PS TRACKER' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(violations).toEqual([]);
});
