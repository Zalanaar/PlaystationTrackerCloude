// «Охочусь сейчас»: закрепить игру за платиной и трофей — прогресс на главной и на вкладке «Трофеи».
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mockApi, trophyList } from './collection-mock';
import { signedSession } from './session';
import { expandToday } from './today';

async function openGame(page: Page, context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }, { name: 'ps-today-open', value: '1', url: baseURL }]);
  const m = await mockApi(page);
  const list = trophyList();
  list[0] = { ...list[0], earned: false, earnedAt: null };
  m.trophies[3] = list;
  m.games.find((g) => g.id === 3)!.trophies = { earned: 53, defined: 78 };
  await page.goto('/?game=3&tab=trophies');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /Трофеи/ })).toHaveAttribute('aria-selected', 'true');
  return { m, dialog };
}

test('закрепить игру и трофей — видно на главной и во вкладке «Трофеи»', async ({ page, context, baseURL }) => {
  const { dialog } = await openGame(page, context, baseURL as string);
  const plat = dialog.getByTestId('hunt-plat');
  await expect(plat).toBeVisible();
  await plat.click();
  await expect(plat).toHaveAttribute('aria-pressed', 'true');

  const row = dialog.locator('.ps-trophy', { hasText: 'Трофей 5' });
  await row.getByTestId('hunt-pin').click();
  await expect(row.getByTestId('hunt-pin')).toHaveAttribute('aria-pressed', 'true');

  await dialog.getByRole('button', { name: 'Закрыть' }).first().click();
  await expect(dialog).toHaveCount(0);
  await expandToday(page);

  const home = page.getByTestId('hunt-now');
  await expect(home).toBeVisible();
  await expect(home).toContainText('Охочусь сейчас');
  await expect(home.getByTestId('hunt-game')).toContainText('Horizon Forbidden West');
  await expect(home.getByTestId('hunt-trophy')).toContainText('Трофей 5');

  await page.goto('/trophies');
  await expect(page.getByRole('heading', { level: 1, name: 'Трофеи' })).toBeVisible();
  const block = page.getByTestId('hunt-now');
  await expect(block).toBeVisible();
  await expect(block.getByTestId('hunt-game')).toContainText('Horizon Forbidden West');
  await expect(block.getByTestId('hunt-trophy')).toContainText('Трофей 5');

  await block.getByTestId('hunt-unpin-game').click();
  await expect(block.getByTestId('hunt-game')).toHaveCount(0);
  await expect(block.getByTestId('hunt-trophy')).toBeVisible();
  await block.getByTestId('hunt-unpin-trophy').click();
  await expect(page.getByTestId('hunt-now')).toHaveCount(0);
});
