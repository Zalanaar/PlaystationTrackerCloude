// Дневник прохождения: датированные заметки в окне игры, в истории и удаление.
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

async function open(page: Page, context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  await page.goto('/?game=6');
  const d = page.getByRole('dialog');
  await expect(d).toBeVisible();
  return d;
}

test('добавить и удалить заметку дневника', async ({ page, context, baseURL }) => {
  const d = await open(page, context, baseURL as string);
  const diary = d.getByTestId('game-diary');
  await diary.getByLabel('Новая заметка').fill('Сегодня прошёл главу');
  await diary.getByTestId('diary-add').click();
  const entry = diary.getByTestId('diary-entry');
  await expect(entry).toContainText('Сегодня прошёл главу');
  await expect(d.getByTestId('history-diary')).toContainText('Сегодня прошёл главу');
  await entry.getByTestId('diary-delete').click();
  await expect(diary.getByTestId('diary-entry')).toHaveCount(0);
  await expect(d.getByTestId('history-diary')).toHaveCount(0);
});
