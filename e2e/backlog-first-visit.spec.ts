// П16.3: первый вход в «Бэклог» с нижней панели. Холодный (данные идут 400 мс): скелет той же раскладки, затем содержимое
// fade без сдвига (CLS ≈ 0). PWA: данные вкладки предзагружены в простое — по касанию запрос списка не повторяется.
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { mockManual } from './manual-mock';
import { signedSession } from './session';

type W = { __cls: number; __tap: number };

async function open(page: Page, baseURL: string, standalone: boolean) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, seed());
  await mockManual(page);
  await page.route('**/api/roadmap', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { items: [], unplanned: [] } }) }));
  await page.route(/\/api\/(games|manual-games|collection\/backlog-age)/, async (r) => { await new Promise((ok) => setTimeout(ok, 400)); await r.fallback(); });
  await page.addInitScript((sa) => {
    localStorage.setItem('ps-wn-seen:1', '99');
    if (sa) Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    const w = window as unknown as W; w.__cls = 0; w.__tap = Infinity;
    // все сдвиги после касания, включая «после ввода» (касание вкладки не должно оправдывать прыжок экрана)
    new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { value: number; startTime: number }[]) if (e.startTime >= w.__tap) w.__cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
  }, standalone);
  await page.goto('/');
  await expect(page.locator('.ps-card').first()).toBeVisible();
}
const tapBacklog = (page: Page) => page.locator('nav.ps-tabbar').getByRole('link', { name: 'Что дальше' })
  .evaluate((el) => { (window as unknown as W).__tap = performance.now(); (el as HTMLElement).click(); });

test('холодный первый вход: скелет, затем содержимое fade без сдвига', async ({ page, baseURL, isMobile }) => {
  test.skip(!isMobile, 'нижняя панель только на телефоне');
  await open(page, baseURL!, false);
  await tapBacklog(page);
  // холодная компиляция /backlog в dev-сервере (WebKit в CI) бывает дольше 5 с
  await expect(page.getByTestId('bl-main-head')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-tour-page="backlog"]')).toHaveAttribute('data-fresh', '');
  const anim = await page.locator('.ps-bl-list').evaluate((el) => getComputedStyle(el).animationName);
  expect(anim).toBe('ps-bl-fresh');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as W).__cls)).toBeLessThan(0.01);
});

test('reduced motion: без fade', async ({ browser, baseURL, isMobile }, info) => {
  test.skip(!isMobile, 'телефон');
  const context = await browser.newContext({ ...info.project.use, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await open(page, baseURL!, false);
  await tapBacklog(page);
  await expect(page.getByTestId('bl-main-head')).toBeVisible();
  expect(await page.locator('.ps-bl-list').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await context.close();
});

test('PWA: данные Бэклога предзагружены в простое — по касанию список не запрашивается заново, без сдвига', async ({ page, baseURL, isMobile }) => {
  test.skip(!isMobile, 'телефон');
  await open(page, baseURL!, true);
  const backlogReq = () => page.waitForRequest((r) => /\/api\/games\?status=backlog/.test(r.url()), { timeout: 8000 });
  await backlogReq(); // предзагрузка в простое (~1,5 с после старта)
  await page.waitForTimeout(600); // ответ (400 мс) лёг в кэш
  let again = false;
  page.on('request', (r) => { if (/\/api\/games\?status=backlog/.test(r.url())) again = true; });
  await tapBacklog(page);
  await expect(page.getByTestId('bl-main-head')).toBeVisible();
  await page.waitForTimeout(500);
  expect(again).toBe(false);
  expect(await page.evaluate(() => (window as unknown as W).__cls)).toBeLessThan(0.01);
});
