// П11.5.1/П11.5.3: плавная смена вкладок на телефоне. Основной путь — View Transition из нижней панели (шапка и панель в своих группах,
// направление по порядку вкладок), прокрутка запоминается по вкладке; без API — fade .ps-route без transform; первая загрузка,
// prefers-reduced-motion и десктоп — без анимации; без сдвига вёрстки.
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

type Probe = { dir: string | null; header: string; tabbar: string; main: string };
type W = { __cls: number; __vt: Probe[] };

async function open(page: Page, baseURL: string, opts: { noApi?: boolean } = {}) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, seed());
  await page.addInitScript((noApi) => {
    const w = window as unknown as W & { __cls: number };
    w.__cls = 0; w.__vt = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
    const d = document as Document & { startViewTransition?: (cb: () => unknown) => unknown };
    if (noApi) { Object.defineProperty(Document.prototype, 'startViewTransition', { value: undefined, configurable: true }); return; }
    const orig = d.startViewTransition;
    if (typeof orig !== 'function') return;
    Document.prototype.startViewTransition = function (this: Document, cb: () => unknown) {
      const name = (sel: string) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).getPropertyValue('view-transition-name') : ''; };
      w.__vt.push({ dir: document.documentElement.getAttribute('data-nav-dir'), header: name('.ps-header'), tabbar: name('.ps-tabbar'), main: name('.ps-main') });
      return orig.call(this, cb);
    } as typeof orig;
  }, !!opts.noApi);
  await page.goto('/');
  await expect(page.locator('.ps-card').first()).toBeVisible();
}
const anim = (page: Page) => page.locator('.ps-route').evaluate((el) => ({ enter: el.hasAttribute('data-enter'), name: getComputedStyle(el).animationName, transform: getComputedStyle(el).transform }));
const vt = (page: Page) => page.evaluate(() => (window as unknown as W).__vt);
const tab = (page: Page, name: string) => page.locator('nav.ps-tabbar').getByRole('link', { name });
// значок Next dev tools в dev-режиме перекрывает левую вкладку: клик через DOM (обычный click, button 0)
const go = (page: Page, name: string) => tab(page, name).evaluate((el) => (el as HTMLElement).click());

test('телефон: View Transition по вкладкам — шапка и панель в своих группах, направление, атрибуты снимаются, без сдвига', async ({ page, baseURL, isMobile }) => {
  test.skip(!isMobile, 'нижние вкладки только на телефоне');
  await open(page, baseURL!);
  expect((await anim(page)).enter).toBe(false);
  test.skip(!(await page.evaluate(() => typeof (document as Document & { startViewTransition?: unknown }).startViewTransition === 'function')), 'нет View Transitions API');
  await go(page, 'Бэклог');
  await expect(page).toHaveURL(/\/backlog/);
  await expect.poll(() => vt(page).then((v) => v.length)).toBe(1);
  expect((await vt(page))[0]).toEqual({ dir: 'fwd', header: 'ps-header', tabbar: 'ps-tabbar', main: 'ps-main' });
  await expect(page.locator('html')).not.toHaveAttribute('data-vt', /.*/);
  // fade шаблона не дублирует снимки
  await go(page, 'Коллекция');
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => vt(page).then((v) => v.length)).toBe(2);
  expect((await vt(page))[1].dir).toBe('back');
  await expect(page.locator('html')).not.toHaveAttribute('data-nav-dir', /.*/);
  // имена групп только на время перехода
  expect(await page.locator('.ps-header').evaluate((el) => getComputedStyle(el).getPropertyValue('view-transition-name'))).toBe('none');
  expect(await page.evaluate(() => (window as unknown as W).__cls)).toBeLessThan(0.01);
});

test('телефон: прокрутка запоминается по вкладке', async ({ page, baseURL, isMobile }) => {
  test.skip(!isMobile, 'телефон');
  await open(page, baseURL!);
  const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  test.skip(max < 300, 'короткая страница');
  const y = Math.min(400, max);
  await page.evaluate((v) => window.scrollTo(0, v), y);
  await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBe(y);
  await go(page, 'Трофеи');
  await expect(page).toHaveURL(/\/trophies/);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await go(page, 'Коллекция');
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBeGreaterThanOrEqual(y - 2);
});

test('телефон без View Transitions API: fade без transform, первая загрузка без анимации', async ({ page, baseURL, isMobile }) => {
  test.skip(!isMobile, 'телефон');
  await open(page, baseURL!, { noApi: true });
  expect((await anim(page)).enter).toBe(false);
  await go(page, 'Бэклог');
  await expect(page).toHaveURL(/\/backlog/);
  await expect(page.locator('.ps-route[data-enter]')).toBeAttached();
  const a = await anim(page);
  expect(a.name).toBe('ps-route-in');
  expect(a.transform).toBe('none');
  // старт анимации на WebKit под нагрузкой CI может запаздывать: ждём конца fade, а не фиксированные 400 мс
  await expect.poll(() => page.locator('.ps-route').evaluate((el) => getComputedStyle(el).opacity), { timeout: 3000 }).toBe('1');
  expect(await page.evaluate(() => (window as unknown as W).__cls)).toBeLessThan(0.01);
});

test('prefers-reduced-motion: без View Transition и без fade', async ({ page, baseURL, isMobile }) => {
  test.skip(!isMobile, 'телефон');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, baseURL!);
  await go(page, 'Бэклог');
  await expect(page).toHaveURL(/\/backlog/);
  await expect(page.locator('.ps-route[data-enter]')).toBeAttached();
  expect((await anim(page)).name).toBe('none');
  expect((await vt(page)) ?? []).toHaveLength(0);
});

test('десктоп: без анимации', async ({ page, baseURL, isMobile }) => {
  test.skip(isMobile, 'десктоп');
  await open(page, baseURL!);
  await page.goto('/backlog');
  await page.locator('header nav[aria-label="Разделы"] a', { hasText: 'Коллекция' }).click();
  await expect(page).toHaveURL(/\/$|\/\?/);
  expect((await anim(page)).name).toBe('none');
  expect((await vt(page)) ?? []).toHaveLength(0);
});
