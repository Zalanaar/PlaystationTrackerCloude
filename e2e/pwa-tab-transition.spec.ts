// П11.5.1: плавная смена вкладок на телефоне — вход раздела с прозрачности (без transform и сдвига вёрстки); первая загрузка без анимации;
// prefers-reduced-motion — без анимации; ?query внутри раздела анимацию не перезапускает.
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

async function open(page: Page, baseURL: string) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, seed());
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/');
  await expect(page.locator('.ps-card').first()).toBeVisible();
}
const anim = (page: Page) => page.locator('.ps-route').evaluate((el) => ({ enter: el.hasAttribute('data-enter'), name: getComputedStyle(el).animationName, transform: getComputedStyle(el).transform }));

test('телефон: переход по нижней вкладке — fade без transform, первая загрузка без анимации', async ({ page, baseURL, isMobile }) => {
  test.skip(!isMobile, 'нижние вкладки только на телефоне');
  await open(page, baseURL!);
  expect((await anim(page)).enter).toBe(false);
  await page.locator('nav.ps-tabbar').getByRole('link', { name: 'Бэклог' }).click();
  await expect(page).toHaveURL(/\/backlog/);
  await expect(page.locator('.ps-route[data-enter]')).toBeAttached();
  const a = await anim(page);
  expect(a.name).toBe('ps-route-in');
  expect(a.transform).toBe('none');
  await page.waitForTimeout(400);
  expect(await page.locator('.ps-route').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.01);
});

test('prefers-reduced-motion: без анимации', async ({ page, baseURL, isMobile }) => {
  test.skip(!isMobile, 'телефон');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, baseURL!);
  await page.locator('nav.ps-tabbar').getByRole('link', { name: 'Бэклог' }).click();
  await expect(page).toHaveURL(/\/backlog/);
  await expect(page.locator('.ps-route[data-enter]')).toBeAttached();
  expect((await anim(page)).name).toBe('none');
});

test('десктоп: без анимации', async ({ page, baseURL, isMobile }) => {
  test.skip(isMobile, 'десктоп');
  await open(page, baseURL!);
  await page.goto('/backlog');
  await page.locator('header nav[aria-label="Разделы"] a', { hasText: 'Коллекция' }).click();
  await expect(page).toHaveURL(/\/$|\/\?/);
  expect((await anim(page)).name).toBe('none');
});
