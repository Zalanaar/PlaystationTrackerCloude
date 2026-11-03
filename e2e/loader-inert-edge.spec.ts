// Фаза 42 (QA): Разбор под лоадером; inert при повторной загрузке (поиск, смена статуса); независимость от вкладок.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const state = { delay: 0 };
async function setup(page: Page, context: BrowserContext, baseURL: string, delay: number) {
  state.delay = delay;
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  await page.route(/\/api\/games(\/batch)?(\?|$)/, async (r) => { // 48.1: блоки хроники идут batch-ем
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

test('смена статуса: refresh после мутации не делает корень inert, ввод в поиск работает', async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!, 0);
  await page.goto('/');
  await expect(page.locator('.ps-card').first()).toBeVisible();
  state.delay = 1500;
  await page.getByRole('button', { name: 'Открыть: Stray' }).first().click(); // диалог: работает и на mobile
  await page.getByRole('dialog', { name: 'Stray' }).getByRole('button', { name: 'Изменить статус' }).click();
  await page.locator('[role=menuitemradio][aria-checked=false]').first().click(); // любой статус, отличный от текущего
  await expect(overlay(page)).toBeVisible({ timeout: 3000 }); // refresh дольше 200 мс
  expect(await overlay(page).getAttribute('data-blocking')).toBe('false');
  expect(await page.locator('.ps-collection').getAttribute('inert')).toBeNull();
  expect(await page.locator('.ps-collection').getAttribute('aria-busy')).toBeNull();
  await page.keyboard.press('Escape'); // закрыть диалог игры
  await expect(page.getByRole('dialog', { name: 'Stray' })).toHaveCount(0);
  const input = page.getByRole('searchbox', { name: 'Поиск игры' });
  await input.click();
  await page.keyboard.type('God', { delay: 30 });
  await expect(input).toHaveValue('God');
  await expect(input).toBeFocused();
});

test('первичная загрузка блокирует корень (inert), повторная нет', async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!, 1500);
  await page.goto('/');
  await expect(overlay(page)).toBeVisible({ timeout: 1200 });
  expect(await overlay(page).getAttribute('data-blocking')).toBe('true');
  expect(await page.locator('.ps-collection').getAttribute('inert')).not.toBeNull();
});
