// Коллекция (телефон): иконка поиска в шапке открывает и закрывает строку, как «Отмена».
// Второй тап не должен снова открыть поле из‑за blur→click на iPhone Safari.
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

async function openHome(page: Page, context: import('@playwright/test').BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, seed());
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
}

const hdr = (page: Page) => page.getByTestId('hdr-search').filter({ visible: true });
const box = (page: Page) => page.getByRole('searchbox', { name: 'Поиск игры' });
const cancel = (page: Page) => page.getByRole('button', { name: 'Отмена' });

test.describe('Коллекция: иконка поиска в шапке', () => {
  test.beforeEach(({ isMobile }) => { test.skip(!isMobile, 'иконка только на телефоне'); });

  test('повторное нажатие закрывает строку, как «Отмена»; aria-expanded', async ({ page, context, baseURL }) => {
    await openHome(page, context, baseURL!);
    await expect(hdr(page)).toBeVisible();
    await expect(hdr(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(box(page)).toHaveCount(0);

    await hdr(page).click();
    await expect(box(page)).toBeVisible();
    await expect(box(page)).toBeFocused();
    await expect(hdr(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(cancel(page)).toBeVisible();

    await hdr(page).click();
    await expect(box(page)).toHaveCount(0);
    await expect(hdr(page)).toHaveAttribute('aria-expanded', 'false');

    await hdr(page).click();
    await expect(box(page)).toBeVisible();
    await cancel(page).click();
    await expect(box(page)).toHaveCount(0);
    await expect(hdr(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('запрос сохраняется при закрытии иконкой; повторное открытие показывает его снова', async ({ page, context, baseURL }) => {
    await openHome(page, context, baseURL!);
    await hdr(page).click();
    await box(page).fill('ведьмак');
    await expect(page).toHaveURL(/q=/);
    await hdr(page).click();
    await expect(box(page)).toHaveCount(0);
    await expect(page).toHaveURL(/q=/);
    await hdr(page).click();
    await expect(box(page)).toHaveValue('ведьмак');
    await expect(hdr(page)).toHaveAttribute('aria-expanded', 'true');
  });

  test('тап по иконке при фокусе в поле закрывает, а не открывает снова', async ({ page, context, baseURL }) => {
    await openHome(page, context, baseURL!);
    await hdr(page).click();
    await expect(box(page)).toBeFocused();
    // как на iPhone: сначала blur поля, затем click по иконке
    await hdr(page).click();
    await expect(box(page)).toHaveCount(0);
    await expect(hdr(page)).toHaveAttribute('aria-expanded', 'false');
  });
});
