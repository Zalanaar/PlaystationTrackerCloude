// П.6 (t281u): поле поиска на Коллекции и в Бэклоге открыто всегда (и на телефоне), кнопки-лупы в шапке нет.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

async function login(page: Page, context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, seed());
}

test.describe('Поиск открыт всегда', () => {
  test('Коллекция: поле видно сразу, лупы нет, запрос попадает в адрес', async ({ page, context, baseURL }) => {
    await login(page, context, baseURL!);
    await page.goto('/');
    await expect(page.locator('[data-tour-page="collection"]')).toHaveAttribute('data-tour-ready', 'true');
    const box = page.getByRole('searchbox', { name: 'Поиск игры' }).filter({ visible: true });
    await expect(box).toHaveCount(1);
    await expect(box).not.toBeFocused();
    await expect(page.getByTestId('hdr-search')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Отмена' })).toHaveCount(0);
    await box.fill('ведьмак');
    await expect(page).toHaveURL(/q=/);
    await page.reload();
    await expect(page.getByRole('searchbox', { name: 'Поиск игры' }).filter({ visible: true })).toHaveValue('ведьмак');
  });

  test('Бэклог: поле видно сразу (и на телефоне), лупы в полосе и шапке нет', async ({ page, context, baseURL }) => {
    await login(page, context, baseURL!);
    await page.goto('/backlog');
    await page.getByRole('heading', { name: 'Бэклог', level: 1 }).waitFor();
    await expect(page.getByTestId('bs-input')).toBeVisible();
    await expect(page.getByTestId('bs-open')).toHaveCount(0);
    await expect(page.getByTestId('hdr-search')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
