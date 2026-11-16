// П9: тихое обновление данных при долгом возврате в приложение и «потяни, чтобы обновить» в установленном PWA.
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const isGames = (u: string) => /\/api\/games(\/|\?|$)/.test(new URL(u).pathname + new URL(u).search);

async function open(page: Page, baseURL: string, standalone = false) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  if (standalone) await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  await page.clock.install();
  await mockApi(page);
  const calls: string[] = [];
  page.on('request', (r) => { if (isGames(r.url())) calls.push(r.url()); });
  await page.goto('/');
  await expect(page.locator('.ps-card:not(.ps-card--sk)').first()).toBeVisible();
  await page.waitForTimeout(300);
  return calls;
}

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

test('короткое переключение не перечитывает, возврат после 3 минут — перечитывает коллекцию без перезагрузки', async ({ page, baseURL }) => {
  const calls = await open(page, baseURL!);
  await page.evaluate(() => { (window as unknown as { __mark: number }).__mark = 1; });
  const n0 = calls.length;
  await setHidden(page, true);
  await page.clock.fastForward(10_000);
  await setHidden(page, false);
  await page.waitForTimeout(500);
  expect(calls.length).toBe(n0);
  await setHidden(page, true);
  await page.clock.fastForward('03:00');
  await setHidden(page, false);
  await expect.poll(() => calls.length).toBeGreaterThan(n0);
  // та же страница, не перезагрузка
  expect(await page.evaluate(() => (window as unknown as { __mark?: number }).__mark)).toBe(1);
  await expect(page.locator('.ps-card:not(.ps-card--sk)').first()).toBeVisible();
});

async function pull(page: Page, dy: number) {
  await page.evaluate((d) => {
    const el = document.querySelector('main') ?? document.body;
    const t = (y: number) => new Touch({ identifier: 1, target: el, clientX: 180, clientY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t(150)], changedTouches: [t(150)] }));
    for (let i = 1; i <= 5; i++) el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [t(150 + (d * i) / 5)], changedTouches: [t(150 + (d * i) / 5)] }));
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t(150 + d)] }));
  }, dy);
}

test('PWA: потянуть с верха страницы — круг крутится, коллекция перечитывается; слабый рывок ничего не делает', async ({ page, baseURL, browserName }, info) => {
  test.skip(info.project.name !== 'mobile' || browserName !== 'chromium', 'тач-события Chromium, телефон');
  const calls = await open(page, baseURL!, true);
  const n0 = calls.length;
  await pull(page, 60); // 30 px после сопротивления — меньше порога
  await page.waitForTimeout(400);
  expect(calls.length).toBe(n0);
  await expect(page.getByTestId('ptr')).not.toHaveAttribute('data-busy', /.*/);
  await pull(page, 220);
  await expect(page.getByTestId('ptr')).toHaveAttribute('data-busy', 'true');
  await expect(page.getByTestId('ptr-live')).toHaveText('Обновляем данные');
  await expect.poll(() => calls.length).toBeGreaterThan(n0);
  await page.clock.fastForward(1500);
  await expect(page.getByTestId('ptr')).not.toHaveAttribute('data-busy', /.*/);
});

test('в браузере (не PWA) жест не перехватывается', async ({ page, baseURL, browserName }, info) => {
  test.skip(info.project.name !== 'mobile' || browserName !== 'chromium', 'тач-события Chromium, телефон');
  const calls = await open(page, baseURL!, false);
  const n0 = calls.length;
  await pull(page, 220);
  await page.waitForTimeout(500);
  await expect(page.getByTestId('ptr')).not.toHaveAttribute('data-busy', /.*/);
  expect(calls.length).toBe(n0);
});
