// Пакет 6, п. 5 (D8): пустые чипы статуса скрыты, на месте пустого «Играю» — «Что начать?» → /recommend.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

const group = (page: Page) => page.getByRole('group', { name: 'Статус' });

async function open(page: Page, context: BrowserContext, baseURL: string, noPlaying: boolean) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const games = noPlaying ? seed().map((g) => (g.status === 'playing' ? { ...g, status: 'completed' as const, completedAt: '2026-10-01T10:00:00.000Z' } : g)) : seed();
  await mockApi(page, games);
  await page.addInitScript(() => localStorage.setItem('ps-wn-seen:1', '14'));
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
  await page.goto('/');
  await expect(group(page).getByRole('button', { name: /^Все: / })).toBeVisible();
}

test('нет игр «Играю»: вместо чипа «Что начать?», ссылка ведёт в Подскажи', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, true);
  await expect(group(page).getByRole('button', { name: /^Играю/ })).toHaveCount(0);
  const hint = page.getByTestId('chip-what-to-start');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText('Что начать?');
  await expect(hint).toHaveAttribute('href', '/recommend');
  // нулевых счётчиков среди видимых чипов нет
  const counts = await group(page).locator('.ps-filterchip__n').allInnerTexts();
  expect(counts.length).toBeGreaterThan(0);
  expect(counts.filter((t) => t.trim() === '0')).toEqual([]);
  // зона нажатия не меньше 44 по высоте на мобильном
  if ((page.viewportSize()?.width ?? 1000) < 768) {
    const b = (await hint.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(30);
  }
  await hint.click();
  await expect(page).toHaveURL(/\/recommend/);
});

test('есть игры «Играю»: чип на месте, подсказки нет', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, false);
  await expect(group(page).getByRole('button', { name: /^Играю/ })).toBeVisible();
  await expect(page.getByTestId('chip-what-to-start')).toHaveCount(0);
});
