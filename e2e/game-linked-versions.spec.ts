// Фаза 23: «Связанные версии» и «Это не дубль» в окне игры (мок-API, контракт api-contract.md).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { signedSession } from './session';

const g = (id: number, title: string, o: Partial<G> = {}): G => ({
  id, title, lastPlayedAt: '2026-10-01T10:00:00.000Z', status: 'completed', completedAt: '2026-10-01T10:00:00.000Z', droppedAt: null,
  playSeconds: 36_000, playCount: 5, trophies: null, ...o,
});

const games = (): G[] => [
  g(1, 'Starfield', { platform: 'PS5', linked: [{ gameId: 2, title: 'Starfield', platform: 'PS4', hours: 4 }] }),
  g(3, 'Stray'),
];

async function open(page: Page, context: BrowserContext, baseURL: string, list: G[]) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, list);
  await page.goto('/?game=1');
  return mock;
}

test('связанные версии показаны, «Это не дубль» с подтверждением обновляет окно', async ({ page, context, baseURL }) => {
  const mock = await open(page, context, baseURL as string, games());
  const dlg = page.getByRole('dialog', { name: 'Starfield' });
  const block = dlg.getByTestId('linked-versions');
  await expect(block.getByRole('heading', { name: 'Связанные версии' })).toBeVisible();
  await expect(block).toContainText('PS4');
  await expect(block).toContainText('4 ч');

  await block.getByRole('button', { name: 'Это не дубль' }).click();
  await block.getByRole('button', { name: 'Отмена' }).click();
  expect(mock.mutations.filter((x) => x.url.includes('not-duplicate'))).toHaveLength(0);

  await block.getByRole('button', { name: 'Это не дубль' }).click();
  await block.getByRole('button', { name: 'Да, разделить' }).click();
  await expect(dlg.getByTestId('linked-versions')).toHaveCount(0);
  expect(mock.mutations.filter((x) => x.method === 'POST' && x.url.endsWith('/api/games/1/not-duplicate'))).toHaveLength(1);
});

test('нет связанных версий: блока нет', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL as string, games());
  await page.goto('/?game=3');
  await expect(page.getByRole('dialog', { name: 'Stray' })).toBeVisible();
  await expect(page.getByTestId('linked-versions')).toHaveCount(0);
});

test('ошибка сервера: сообщение, блок остаётся', async ({ page, context, baseURL }) => {
  const mock = await open(page, context, baseURL as string, games());
  const block = page.getByRole('dialog', { name: 'Starfield' }).getByTestId('linked-versions');
  await block.getByRole('button', { name: 'Это не дубль' }).click();
  mock.failNextMutation = 503;
  await block.getByRole('button', { name: 'Да, разделить' }).click();
  await expect(block.getByRole('alert')).toContainText('Не удалось разделить');
  await expect(block).toBeVisible();
});
