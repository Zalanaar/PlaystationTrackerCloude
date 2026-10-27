import { test, expect } from '@playwright/test';
import { signedSession } from './session';

test('с валидной сессией главная рендерит панель синка', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByRole('heading', { name: 'Синхронизация с PSN' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
  // БД в e2e недоступна: статус 503, страница не падает
  await expect(page.getByText('Не удалось получить статус синка.')).toBeVisible();
});
