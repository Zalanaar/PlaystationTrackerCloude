// Фаза 42 (QA): Разбор под лоадером; inert при повторной загрузке (поиск, смена статуса); независимость от вкладок.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const state = { delay: 0 };
async function setup(page: Page, context: BrowserContext, baseURL: string, delay: number) {
  state.delay = delay;
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  await page.route(/\/api\/games(\?|$)/, async (r) => {
    await new Promise((res) => setTimeout(res, state.delay));
    await r.fallback();
  });
}
const overlay = (page: Page) => page.getByTestId('loader-overlay');

test('Разбор: оверлей на медленном запросе, inert снимается', async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!, 1500);
  await page.goto('/triage');
  await expect(overlay(page)).toBeVisible({ timeout: 1200 });
  expect(await page.locator('[data-tour-page="triage"]').getAttribute('inert')).not.toBeNull();
  await expect(overlay(page)).toHaveCount(0, { timeout: 6000 });
  expect(await page.locator('[data-tour-page="triage"]').getAttribute('inert')).toBeNull();
});

test('поиск: медленная перезагрузка не отбирает фокус и не теряет ввод', async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!, 0);
  await page.goto('/');
  await expect(page.locator('.ps-card').first()).toBeVisible();
  state.delay = 1500;
  const input = page.getByRole('searchbox', { name: 'Поиск игры' });
  await input.click();
  await input.pressSequentially('Вед', { delay: 50 });
  await expect(overlay(page)).toBeVisible({ timeout: 3000 }); // запрос по «Вед» дольше 200 мс
  // пользователь продолжает печатать, пока оверлей виден
  await page.keyboard.type('ьмак', { delay: 50 });
  await expect(input).toHaveValue('Ведьмак');
  await expect(input).toBeFocused();
});
