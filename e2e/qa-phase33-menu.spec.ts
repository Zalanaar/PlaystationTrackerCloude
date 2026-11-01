// QA Ф33: меню «…» нижних строк «Списка» на 360x640 доступно целиком (скролл при открытом меню, последняя строка).
import { test, expect } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { signedSession } from './session';

test.use({ storageState: { cookies: [], origins: [] } });
const bl = (id: number, title: string): G => ({ id, title, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null });

test('меню нижних строк: последняя строка после скролла и строка у нижней навигации', async ({ page, context, baseURL }) => {
  test.skip((page.viewportSize()?.width ?? 1280) >= 768, 'мобильный');
  test.fail(true, 'БАГ QA-33-1: пункты меню «…» последней строки уходят под нижнюю навигацию и недоступны; убрать после исправления');
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL as string }]);
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
  await mockApi(page, Array.from({ length: 8 }, (_, i) => bl(i + 1, `Игра ${i + 1}`)));
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/backlog');
  await page.locator('.ps-blrow').first().waitFor();
  const tab = (await page.locator('.ps-tabbar').boundingBox())!;
  // 1) нижняя строка в области видимости: меню открывается, затем страницу можно прокрутить, чтобы увидеть все пункты
  await page.getByRole('button', { name: 'Действия: Игра 3' }).click();
  const menu = page.getByRole('menu').first();
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  const n = await items.count();
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  await expect(menu).toBeVisible(); // не закрылось от скролла
  const last = (await items.nth(n - 1).boundingBox())!;
  expect(last.y + last.height, 'последний пункт меню строки 3 после скролла выше нижней навигации').toBeLessThanOrEqual(tab.y + 0.5);
  await page.keyboard.press('Escape');
  // 2) самая последняя строка внизу страницы
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.getByRole('button', { name: 'Действия: Игра 8' }).click();
  const m2 = page.getByRole('menu').first();
  await expect(m2).toBeVisible();
  const box = (await m2.boundingBox())!;
  const lastItem = (await m2.getByRole('menuitem').last().boundingBox())!;
  test.info().annotations.push({ type: 'last-row-menu', description: `menu bottom=${box.y + box.height}, tab top=${tab.y}, last item bottom=${lastItem.y + lastItem.height}` });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last2 = (await m2.getByRole('menuitem').last().boundingBox())!;
  expect(last2.y + last2.height, 'пункты меню последней строки после скролла в конец выше навигации').toBeLessThanOrEqual(tab.y + 0.5);
});
