// QA Фаза 8: edge-кейсы UI. Скрыть «Играю», сброс всех при 0 статусах, тост над окном (hit-test), 390px без горизонтального скролла.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

async function open(page: Page, context: BrowserContext, baseURL: string, url = '/', games = seed()) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, games);
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Статус' }).getByRole('button', { name: /^Все/ })).toContainText(/\d/);
  return mock;
}
const coll = (page: Page) => page.locator('section[aria-labelledby="coll-title"]');
const card = (scope: ReturnType<Page['locator']>, page: Page, title: string) =>
  scope.locator('article.ps-card').filter({ has: page.locator('.ps-card__title', { hasText: new RegExp(`^${title}$`) }) });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function menu(page: Page, mobile: boolean, item: RegExp) {
  if (mobile) await page.getByRole('button', { name: 'Фильтры' }).click();
  else await page.getByRole('button', { name: 'Ещё: действия с коллекцией' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test.describe('QA Фаза 8: edge', () => {
  test('скрыть игру со статусом «Играю»: пропадает из hero и блока «Сейчас», возврат со статусом', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    // после Фазы 22 игра «Играю» видна дважды: hero сверху и карточка в блоке «Сейчас»
    const banner = page.getByRole('button', { name: 'Открыть: Horizon Forbidden West' });
    const now = page.getByTestId('now-block');
    await expect(banner).toHaveCount(2);
    await expect(now.getByRole('heading', { name: 'Сейчас' })).toBeVisible();
    await banner.first().click();
    await page.getByRole('dialog', { name: 'Horizon Forbidden West' }).getByRole('button', { name: 'Убрать из коллекции' }).click();
    await expect(card(coll(page), page, 'Horizon Forbidden West')).toHaveCount(0);
    await expect(banner).toHaveCount(0);
    await expect(now).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Статус' }).getByRole('button', { name: /Играю/ })).not.toContainText('1');
    expect(mock.games.find((g) => g.id === 3)?.status).toBe('playing');
    await page.getByRole('button', { name: 'Вернуть', exact: true }).click();
    await expect(banner).toHaveCount(2);
    await expect(now).toBeVisible();
    expect(mock.games.find((g) => g.id === 3)?.status).toBe('playing');
  });

  test('сброс всех при 0 статусах: «сбрасывать нечего», запрос не уходит', async ({ page, context, baseURL }, info) => {
    const games = seed().map((g) => ({ ...g, status: null, completedAt: null, droppedAt: null }));
    const mock = await open(page, context, baseURL!, '/', games);
    await menu(page, info.project.name === 'mobile', /Сбросить все статусы/);
    const dlg = page.getByRole('dialog', { name: 'Сбросить все статусы' });
    await expect(dlg).toContainText('сбрасывать нечего');
    await expect(dlg.getByRole('button', { name: 'Сбросить статусы' })).toHaveCount(0);
    await dlg.locator('.ps-reset__btns').getByRole('button', { name: 'Закрыть' }).click();
    await expect(dlg).toHaveCount(0);
    expect(mock.mutations.filter((m) => m.url.endsWith('/status-reset-all'))).toEqual([]);
  });

  test('тост «Отменить» поверх окна игры: hit-test попадает в кнопку тоста', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await card(coll(page), page, 'God of War').locator('.ps-card__hit').click();
    const dlg = page.getByRole('dialog', { name: 'God of War' });
    await dlg.getByRole('button', { name: 'Сбросить статус' }).click();
    const undo = page.getByRole('button', { name: 'Отменить' });
    await expect(undo).toBeVisible();
    await expect(dlg).toBeVisible();
    const box = await undo.boundingBox();
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return { inToast: !!el?.closest('.ps-toasts'), parentIsBody: document.querySelector('.ps-toasts')?.parentElement === document.body };
    }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
    expect(hit).toEqual({ inToast: true, parentIsBody: true });
  });

  test('390px: коллекция, «Скрытые», окно сброса, окно игры без горизонтального скролла', async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, context, baseURL!, '/?sort=last_played');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await card(coll(page), page, 'God of War').locator('.ps-card__hit').click();
    await expect(page.getByRole('dialog', { name: 'God of War' })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await menu(page, await page.getByRole('button', { name: 'Фильтры' }).isVisible(), /Сбросить все статусы/);
    await expect(page.getByRole('dialog', { name: 'Сбросить все статусы' })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await page.goto('/?hidden=1');
    await expect(page.getByRole('heading', { name: 'Скрытых игр нет' })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});
