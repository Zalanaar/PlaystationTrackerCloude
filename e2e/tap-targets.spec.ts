// Пакет 6, п. 2: зоны нажатия на мобильном не меньше 44×44 на `/` и `/stats` без изменения вида
// (видимые размеры те же, зону добирает ::after; мерим, куда попадает тап — см. e2e/tap-helpers.ts).
import { test, expect } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';
import { open as openStats } from './stats-mock';
import { smallHitTargets } from './tap-helpers';

test.describe('зоны нажатия 44 (пакет 6, п. 2)', () => {
  test.beforeEach(({ isMobile }) => test.skip(!isMobile, 'только мобильный и iPhone'));

  test('/: чипы месяцев, заголовок года, «Все», меню карточек', async ({ page, context, baseURL }) => {
    test.setTimeout(60_000);
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    await mockApi(page);
    await page.goto('/');
    await expect(page.locator('.ps-card:not(.ps-card--sk)').first()).toBeVisible();
    await expect(page.locator('.ps-mchip').first()).toBeVisible();
    expect(await smallHitTargets(page, 'body')).toEqual([]);
  });

  test('/stats: чипы разделов, жанры, переключатели, «Вся лента», меню', async ({ page, context, baseURL }) => {
    test.setTimeout(60_000);
    await openStats(page, context, baseURL!);
    await expect(page.locator('.ps-st-secs__chip').first()).toBeVisible();
    await expect(page.locator('.ps-st-bar').first()).toBeVisible();
    expect(await smallHitTargets(page, 'body')).toEqual([]);
  });

  test('вид не меняется: размеры элементов прежние', async ({ page, context, baseURL }) => {
    await openStats(page, context, baseURL!);
    const chip = (await page.locator('.ps-st-secs__chip').first().boundingBox())!;
    expect(Math.round(chip.height)).toBe(36);
    const mm = page.locator('.ps-mm').first();
    if (await mm.count()) expect(Math.round((await mm.boundingBox())!.width)).toBeLessThanOrEqual(28);
  });
});
