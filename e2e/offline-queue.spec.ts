// Офлайн-очередь: статус, поставленный без сети, уходит после появления связи. Индикатор очереди виден.
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

async function open(page: Page, context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const m = await mockApi(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Статус: Stray' })).toBeVisible();
  return m;
}

test('смена статуса без сети попадает в очередь и уходит, когда сеть вернулась', async ({ page, context, baseURL }) => {
  const m = await open(page, context, baseURL as string);
  const before = m.mutations.length;
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByRole('button', { name: 'Статус: Stray' }).click();
  await page.getByRole('menuitemradio', { name: 'Отложено' }).click();
  await expect(page.getByText('Сохраним, когда появится сеть')).toBeVisible();
  await expect(page.getByTestId('offline-queue')).toBeVisible();
  expect(m.mutations.length).toBe(before);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => m.mutations.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'shelved' } });
  await expect(page.getByTestId('offline-queue')).toHaveCount(0);
});
