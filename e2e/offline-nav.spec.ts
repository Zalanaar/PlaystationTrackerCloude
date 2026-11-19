// F22 (аудит UX): без сети касание раздела, который не пришёл из кэша, даёт тост, а не тишину; подсветка вкладки откатывается.
import { test, expect } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

test('без сети: «Статистика» — тост «Раздел недоступен без сети», адрес и вкладка прежние', async ({ page, context, baseURL, isMobile }) => {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await mockApi(page, seed());
  await page.goto('/');
  await expect(page.locator('.ps-card:not(.ps-card--sk)').first()).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const nav = isMobile ? page.locator('nav.ps-tabbar') : page.locator('nav.ps-nav');
  await nav.getByRole('link', { name: /Статистика/ }).click();
  await expect(page.getByText('Раздел недоступен без сети', { exact: false })).toBeVisible({ timeout: 5000 });
  expect(new URL(page.url()).pathname).toBe('/');
  await expect(nav.locator('[aria-current="page"]')).toHaveText(/Коллекция/);
  await context.setOffline(false);
});
