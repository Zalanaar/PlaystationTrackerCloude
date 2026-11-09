// Пакет 6 (JS главной): бюджет JS первого захода на `/` в прод-сборке. Было ~1,07 МБ (Next качал JS всех разделов
// таббара и окно игры сразу после гидрации), стало ~0,77 МБ: разделы — по намерению (IntentLink), окна — по первому открытию.
import { test, expect } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

const BUDGET_KB = 900;

test('`/`: JS первого захода в бюджете, переход по таббару и окно игры работают', async ({ page, context, baseURL }, info) => {
  test.skip(info.project.name !== 'mobile', 'бюджет меряем на мобильном');
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await mockApi(page, seed());
  await page.addInitScript(() => localStorage.setItem('ps-wn-seen:1', '14'));
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
  const sizes: number[] = [];
  page.on('response', async (r) => {
    if (!r.url().endsWith('.js')) return;
    try { sizes.push((await r.body()).length); } catch { /* ответ мог закрыться */ }
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  const kb = sizes.reduce((a, b) => a + b, 0) / 1024;
  expect(kb, `JS на старте ${Math.round(kb)} КБ`).toBeLessThan(BUDGET_KB);

  // окно игры открывается, хотя чанк не качался заранее
  await page.locator('.ps-results .ps-card').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // переход по таббару (без предзагрузки по экрану)
  await page.locator('.ps-tabbar').getByRole('link', { name: 'Статистика' }).click();
  await expect(page).toHaveURL(/\/stats/);
});
