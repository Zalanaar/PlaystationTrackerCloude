// П.4 (t281u): вкладка «Что дальше» открывает последнюю подвкладку (Бэклог / План / Подскажи).
import { test, expect } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

test('«Что дальше» помнит последнюю подвкладку', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await mockApi(page, seed());
  await page.goto('/roadmap');
  const next = page.getByRole('link', { name: 'Что дальше' }).filter({ visible: true });
  await expect(next).toHaveAttribute('href', '/roadmap');
  await page.getByRole('link', { name: 'Коллекция' }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(next).toHaveAttribute('href', '/roadmap');
  await next.click();
  await expect(page).toHaveURL(/\/roadmap$/);
  // после перезагрузки на другой вкладке память сохраняется; смена подвкладки перезаписывает
  await page.goto('/recommend');
  await expect(next).toHaveAttribute('href', '/recommend');
  await page.goto('/stats');
  await expect(next).toHaveAttribute('href', '/recommend');
  await page.goto('/backlog');
  await expect(next).toHaveAttribute('href', '/backlog');
});
