// QA хвостов 2026-10-31: CSP на nonce на ключевых экранах без networkidle (в прод-сборке next start и в dev). Нарушения ловятся по console и securitypolicyviolation.
// Прод: QA_PORT=3218 npx playwright test -c e2e/qa-prod.config.ts csp-nonce
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

const PAGES = ['/', '/stats', '/backlog', '/roadmap', '/recommend', '/wrapped', '/triage', '/?game=1', '/?game=1&tab=trophies', '/access', '/onboarding'] as const;

async function watch(page: Page) {
  const v: string[] = [];
  page.on('console', (m) => { if (/content security policy|violates the following|Refused to/i.test(m.text())) v.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => v.push(`pageerror: ${e.message.slice(0, 200)}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __csp: string[] }).__csp = [...((window as unknown as { __csp?: string[] }).__csp ?? []), `${e.violatedDirective} ${e.blockedURI}`];
    });
  });
  return v;
}
const swallowed = (page: Page) => page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);

test('положительный контроль: слушатель ловит нарушение', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await mockApi(page, seed());
  const v = await watch(page);
  await page.goto('/');
  await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__x=1'; document.head.appendChild(s); });
  await page.waitForTimeout(300);
  expect((await swallowed(page)).length + v.length).toBeGreaterThan(0);
});

test('экраны под CSP: нет нарушений и ошибок страницы', async ({ page, context, baseURL }) => {
  test.setTimeout(150_000);
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await mockApi(page, seed());
  const v = await watch(page);
  const bad: string[] = [];
  for (const p of PAGES) {
    await page.goto(p);
    await page.waitForLoadState('load');
    await page.waitForTimeout(1200);
    bad.push(...(await swallowed(page)).map((x) => `${p}: ${x}`));
  }
  // тема переключается и сохраняется под CSP
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('ps-theme', 'ps3'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ps3');
  expect(v.concat(bad)).toEqual([]);
});

test('без сессии: /login без нарушений, страница редиректит на /login, API даёт 401 с CSP', async ({ page, request }) => {
  const v = await watch(page);
  await page.goto('/stats');
  await expect(page).toHaveURL(/\/login\?next=%2Fstats/);
  await page.waitForLoadState('load');
  await page.waitForTimeout(800);
  expect(v.concat(await swallowed(page))).toEqual([]);
  for (const path of ['/api/games', '/api/stats', '/api/auth/me', '/api/cron/sync']) {
    const r = await request.get(path, { maxRedirects: 0 });
    expect(r.status(), path).toBe(401);
    expect(r.headers()['content-security-policy'], `${path} CSP`).toContain("script-src 'self' 'nonce-");
    expect(r.headers()['x-content-type-options'], path).toBe('nosniff');
    expect(r.headers()['cache-control'], path).toBe('no-store');
  }
});

test('manifest и иконки открыты без сессии, со строгим CSP', async ({ request }) => {
  for (const path of ['/manifest.webmanifest', '/icon.svg', '/apple-icon.png', '/favicon.ico']) {
    const r = await request.get(path, { maxRedirects: 0 });
    expect(r.status(), path).toBe(200);
    expect(r.headers()['content-security-policy'], path).toContain("default-src 'none'");
    expect(r.headers()['x-frame-options'], path).toBe('DENY');
  }
});

test('тур запускается и проходит до конца под CSP без нарушений', async ({ page, context, baseURL }) => {
  test.setTimeout(120_000);
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await mockApi(page, seed());
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 0, shouldAutoStart: true } }) }));
  const v = await watch(page);
  await page.goto('/');
  const count = page.getByTestId('tour-count');
  await expect(count).toHaveText('1 из 14', { timeout: 10_000 });
  for (let i = 1; i < 14; i++) {
    await page.getByRole('dialog').filter({ has: count }).getByRole('button', { name: /Далее|Готово/ }).click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(600);
  expect(v.concat(await swallowed(page))).toEqual([]);
});
