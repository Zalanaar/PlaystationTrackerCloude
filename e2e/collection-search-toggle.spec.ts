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
  // коллекция гидратировалась и слушает кнопку шапки
  await expect(page.locator('[data-tour-page="collection"]')).toHaveAttribute('data-tour-ready', 'true');
  await expect(hdr(page)).toBeVisible();
}

const hdr = (page: Page) => page.getByTestId('hdr-search').filter({ visible: true });
const box = (page: Page) => page.getByRole('searchbox', { name: 'Поиск игры' });
const cancel = (page: Page) => page.getByRole('button', { name: 'Отмена' });

async function openSearch(page: Page) {
  await expect(hdr(page)).toHaveAttribute('aria-expanded', 'false');
  await hdr(page).click();
  await expect(box(page)).toBeVisible();
}

test.describe('Коллекция: иконка поиска в шапке', () => {
  test.beforeEach(({ isMobile }) => { test.skip(!isMobile, 'иконка только на телефоне'); });

  test('повторное нажатие закрывает строку, как «Отмена»; aria-expanded', async ({ page, context, baseURL }) => {
    await openHome(page, context, baseURL!);
    await expect(box(page)).toHaveCount(0);

    await openSearch(page);
    await expect(box(page)).toBeFocused();
    await expect(hdr(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(cancel(page)).toBeVisible();

    await hdr(page).click();
    await expect(box(page)).toHaveCount(0);
    await expect(hdr(page)).toHaveAttribute('aria-expanded', 'false');

    await openSearch(page);
    await cancel(page).click();
    await expect(box(page)).toHaveCount(0);
    await expect(hdr(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('запрос сохраняется при закрытии иконкой; повторное открытие показывает его снова', async ({ page, context, baseURL }) => {
    await openHome(page, context, baseURL!);
    await openSearch(page);
    await box(page).fill('ведьмак');
    await expect(page).toHaveURL(/q=/);
    await hdr(page).click();
    await expect(box(page)).toHaveCount(0);
    await expect(page).toHaveURL(/q=/);
    await openSearch(page);
    await expect(box(page)).toHaveValue('ведьмак');
    await expect(hdr(page)).toHaveAttribute('aria-expanded', 'true');
  });

  test('тап по иконке при фокусе в поле закрывает, а не открывает снова', async ({ page, context, baseURL }) => {
    await openHome(page, context, baseURL!);
    await openSearch(page);
    await box(page).focus();
    await expect(box(page)).toBeFocused();
    // как на iPhone: поле в фокусе, тап по иконке (blur не должен снова открыть строку)
    await hdr(page).click();
    await expect(box(page)).toHaveCount(0);
    await expect(hdr(page)).toHaveAttribute('aria-expanded', 'false');
  });
});
