// П11.5.2: холодный старт PWA без чёрного экрана — манифест и заставки iOS в цвет темы из cookie; заставка .ps-boot в HTML
// (только PWA: navigator.standalone / display-mode: standalone) до гидратации; вне PWA её нет и картинка не грузится.
import { test, expect } from '@playwright/test';

const THEME_COOKIE = 'ps-theme';

test('тема ps4 из cookie: ссылка на манифест, цвета манифеста, заставки iOS из папки темы', async ({ page, context, request, baseURL }) => {
  await context.addCookies([{ name: THEME_COOKIE, value: 'ps4', url: baseURL! }]);
  await page.goto('/login');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest?theme=ps4');
  const m = await (await request.get(`${baseURL}/manifest.webmanifest?theme=ps4`)).json();
  expect([m.background_color, m.theme_color]).toEqual(['#02173d', '#02173d']);
  const bad = await (await request.get(`${baseURL}/manifest.webmanifest?theme=__proto__`)).json();
  expect(bad.background_color).toBe('#0e0f16');
  const links = await page.locator('link[rel="apple-touch-startup-image"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')!));
  expect(links).toHaveLength(12);
  for (const href of links) {
    expect(href).toMatch(/^\/splash\/ps4\/iphone-\d+x\d+\.png$/);
    const r = await request.get(`${baseURL}${href}`, { maxRedirects: 0 });
    expect(r.status(), href).toBe(200);
    const b = await r.body();
    const [w, h] = /(\d+)x(\d+)\.png$/.exec(href)!.slice(1).map(Number);
    expect([b.readUInt32BE(16), b.readUInt32BE(20)], href).toEqual([w, h]);
  }
});

test('вне PWA заставки нет, после гидратации html[data-hydrated]', async ({ page }) => {
  const icons: string[] = [];
  page.on('request', (r) => { if (r.url().includes('icon-maskable-512')) icons.push(r.url()); });
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
  await expect(page.locator('.ps-boot')).toBeHidden();
  expect(icons).toEqual([]);
});

test('PWA (запуск с экрана «Домой»): заставка в цвет темы до гидратации, потом скрыта', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: THEME_COOKIE, value: 'ps3', url: baseURL! }]);
  // как iOS-PWA: navigator.standalone = true (display-mode в Playwright не эмулируется)
  await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }));
  // до гидратации: скрипты Next не грузятся — заставка видна, фон темы
  await page.route(/\/_next\/static\/chunks\/.*\.js/, (r) => r.abort());
  await page.goto('/login');
  await expect(page.locator('html')).toHaveClass(/ps-standalone/);
  const boot = page.locator('.ps-boot');
  await expect(boot).toBeVisible();
  expect(await boot.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(16, 7, 11)');
  // новая вкладка без блокировки скриптов: после гидратации заставки нет
  const p2 = await context.newPage();
  await p2.goto('/login');
  await expect(p2.locator('html')).toHaveClass(/ps-standalone/);
  await expect(p2.locator('html')).toHaveAttribute('data-hydrated', '', { timeout: 15_000 });
  await expect(p2.locator('.ps-boot')).toBeHidden();
});
