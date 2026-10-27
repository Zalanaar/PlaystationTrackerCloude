import { test, expect } from '@playwright/test';
import { signedSession } from './session';

test('с валидной сессией главная показывает пустое состояние', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  await expect(page.getByRole('heading', { name: 'Пока пусто' })).toBeVisible();
});
