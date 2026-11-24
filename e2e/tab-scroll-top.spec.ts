// Повторное касание текущей вкладки нижнего меню на телефоне — плавная прокрутка вверх. Другая вкладка — обычный переход.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed, type G } from './collection-mock';
import { signedSession } from './session';
import { baseState, mockRoadmap } from './roadmap-mock';

const done = (id: number, month: number, day: number): G => ({
  id, title: `Пройдена ${id}`, lastPlayedAt: new Date(Date.UTC(2026, month, day, 10)).toISOString(), status: 'completed',
  completedAt: new Date(Date.UTC(2026, month, day, 10)).toISOString(), droppedAt: null, playSeconds: 3600 * 5, playCount: 3, trophies: null,
});
const list = (): G[] => [...seed(), ...Array.from({ length: 36 }, (_, i) => done(500 + i, 9 - Math.floor(i / 6), 20 - (i % 6)))];

async function open(page: Page, context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, list());
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
}

test.describe('повторное касание вкладки — вверх', () => {
  test.beforeEach(({ isMobile }) => test.skip(!isMobile, 'только нижнее меню телефона'));

  test('на текущей вкладке прокрутка вверх, на другой — переход', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    const tabs = page.locator('nav.ps-tabbar');
    await expect(tabs.getByRole('link', { name: /Коллекция/ })).toHaveAttribute('aria-current', 'page');
    await page.evaluate(() => window.scrollTo(0, 1600));
    await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBeGreaterThan(400);

    await tabs.getByRole('link', { name: /Коллекция/ }).click();
    await expect(page).toHaveURL(/\/(?:\?|$)/);
    await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBe(0);
    await expect(tabs.getByRole('link', { name: /Коллекция/ })).toHaveAttribute('aria-current', 'page');

    await tabs.getByRole('link', { name: /Статистика/ }).click();
    await expect(page).toHaveURL(/\/stats/);
    await expect(tabs.getByRole('link', { name: /Статистика/ })).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('повторное касание «Что дальше» на подвкладке', () => {
  test.beforeEach(({ isMobile }) => test.skip(!isMobile, 'только нижнее меню телефона'));

  test('на Плане остаёмся на /roadmap и прокручиваем вверх, не уходим в Бэклог', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL as string }]);
    await mockApi(page, list());
    await mockRoadmap(page, baseState());
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/roadmap');
    await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
    await expect(page.locator('nav.ps-tabbar a[aria-current="page"]')).toContainText('Что дальше');
    await expect(page.locator('nav[aria-label="Что дальше"] a[aria-current="page"]')).toHaveText('План');

    await page.evaluate(() => {
      const main = document.querySelector('.ps-main, main') as HTMLElement | null;
      if (main && document.documentElement.scrollHeight < 2200) main.style.minHeight = '3200px';
      window.scrollTo(0, 1600);
    });
    await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBeGreaterThan(400);

    await page.locator('nav.ps-tabbar').getByRole('link', { name: /Что дальше/ }).click();
    await expect(page).toHaveURL(/\/roadmap/);
    await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBe(0);
    await expect(page.locator('nav[aria-label="Что дальше"] a[aria-current="page"]')).toHaveText('План');
    await expect(page.getByRole('heading', { name: 'План', level: 1 })).toBeVisible();
  });
});
