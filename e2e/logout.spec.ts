// Фаза 45: «Выйти» и «Выйти на всех устройствах». UI с эмуляцией API (БД в e2e нет) + сами роуты без моков (до БД: Origin, 401, 503).
// Серверный отзыв (копия cookie не пускает, эпоха входа) доказывает src/server/auth/session-revocation.test.ts на PGlite.
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { isMobile } from './backlog-ui';
import { signedSession } from './session';

const tourStub = JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } });
const ok = (r: Route, data: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });

async function open(page: Page, context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: tourStub }));
  await page.addInitScript(() => localStorage.setItem('ps-wn-seen:1', '14'));
  await mockApi(page, seed());
  const calls: string[] = [];
  for (const path of ['logout', 'logout-all']) {
    await page.route(`**/api/auth/${path}`, async (r) => {
      calls.push(`${r.request().method()} ${path} ${r.request().headers()['content-type'] ?? ''}`);
      await context.clearCookies(); // как Set-Cookie Max-Age=0 у настоящего роута
      return ok(r, {});
    });
  }
  await page.goto('/');
  await page.locator('main').waitFor();
  return calls;
}

async function openMenu(page: Page) {
  if (isMobile(page)) await page.getByRole('button', { name: 'Меню', exact: true }).click();
  else await page.getByRole('button', { name: /Профиль|Меню профиля/ }).click();
}
const logoutAllItem = (page: Page) => page.getByTestId(isMobile(page) ? 'sheet-logout-all' : 'menu-logout-all');

test.describe('меню: выход', () => {
  test('«Выйти» шлёт POST /api/auth/logout и ведёт на /login', async ({ page, context, baseURL }) => {
    const calls = await open(page, context, baseURL!);
    await openMenu(page);
    await page.getByRole(isMobile(page) ? 'button' : 'menuitem', { name: 'Выйти', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(calls).toEqual(['POST logout application/json']);
  });

  test('«Выйти на всех устройствах»: подтверждение, POST /api/auth/logout-all, переход на /login', async ({ page, context, baseURL }) => {
    const calls = await open(page, context, baseURL!);
    await openMenu(page);
    const item = logoutAllItem(page);
    await expect(item).toHaveText('Выйти на всех устройствах');
    const box = await item.boundingBox();
    if (isMobile(page)) expect(box!.height).toBeGreaterThanOrEqual(44);
    let message = '';
    page.once('dialog', (d) => { message = d.message(); void d.accept(); });
    await item.click();
    await expect(page).toHaveURL(/\/login/);
    expect(message).toContain('Выйти на всех устройствах?');
    expect(calls).toEqual(['POST logout-all application/json']);
  });

  test('отмена подтверждения: запроса нет, остаёмся на странице', async ({ page, context, baseURL }) => {
    const calls = await open(page, context, baseURL!);
    await openMenu(page);
    page.once('dialog', (d) => void d.dismiss());
    await logoutAllItem(page).click();
    await page.waitForTimeout(300);
    expect(calls).toEqual([]);
    await expect(page).not.toHaveURL(/\/login/);
  });
});

test.describe('роуты выхода без моков', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'только API'); });

  test('logout: с сессией 200 и очистка cookie (БД нет, revoked: false); чужой Origin 400', async ({ request }) => {
    const cookie = `pst_session=${await signedSession()}`;
    const bad = await request.post('/api/auth/logout', { data: {}, headers: { cookie, origin: 'https://evil.example' } });
    expect(bad.status()).toBe(400);
    const r = await request.post('/api/auth/logout', { data: {}, headers: { cookie } });
    expect(r.status()).toBe(200);
    expect(await r.json()).toEqual({ ok: true, data: { revoked: false } });
    expect(r.headers()['set-cookie']).toMatch(/pst_session=;.*Max-Age=0/i);
  });

  test('logout-all: без сессии 401, чужой Origin 400, не JSON 400, с сессией доходит до БД (503)', async ({ request }) => {
    expect((await request.post('/api/auth/logout-all', { data: {} })).status()).toBe(401);
    const cookie = `pst_session=${await signedSession()}`;
    expect((await request.post('/api/auth/logout-all', { data: {}, headers: { cookie, origin: 'https://evil.example' } })).status()).toBe(400);
    expect((await request.post('/api/auth/logout-all', { form: { a: '1' }, headers: { cookie } })).status()).toBe(400);
    const r = await request.post('/api/auth/logout-all', { data: {}, headers: { cookie } });
    expect(r.status()).toBe(503);
    expect((await r.json()).error.code).toBe('db_unavailable');
  });
});
