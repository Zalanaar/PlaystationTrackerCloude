import { test, expect } from '@playwright/test';
import { signedSession } from './session';

test('с валидной сессией главная рендерит каркас, панель синка в окне', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  // D-P2: на мобильном вместо логотипа название раздела
  await expect(page.locator('.ps-header').getByText(/^(PS TRACKER|Коллекция)$/).filter({ visible: true }).first()).toBeVisible();
  // БД в e2e недоступна: коллекция показывает ошибку, страница не падает
  await expect(page.getByText('Что-то пошло не так')).toBeVisible();
  await page.getByRole('button', { name: /Открыть синк/ }).click();
  await expect(page.getByRole('heading', { name: 'Синхронизация с PSN' })).toBeVisible();
  await expect(page.getByText('Не удалось получить статус синка.')).toBeVisible();
});
