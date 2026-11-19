// F2: часы года в хронике коллекции подписаны «в этих играх» и на телефоне (иначе «548 ч» спорит с «≈ 502 ч» Статистики).
import { test, expect } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

test('подпись часов года видна на телефоне и на компьютере, без горизонтального скролла', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await mockApi(page, seed());
  await page.goto('/');
  const cap = page.locator('.ps-year__more--keep').first();
  await expect(cap).toBeVisible();
  await expect(cap).toHaveText('в этих играх');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
