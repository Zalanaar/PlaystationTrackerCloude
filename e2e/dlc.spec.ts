// Фаза 36 (frontend): DLC в прогнозе платины, «Ближе всего к платине» и списке трофеев (контракт 14.2, 15.3).
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed, trophyList } from './collection-mock';
import { signedSession } from './session';

const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'] as const;
const setTheme = (page: Page, t: string) =>
  page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

const FORECAST = {
  setId: 1, required: 54, earned: 49, progress: 91, remaining: { gold: 1, silver: 1, bronze: 3, total: 5 }, remainingHidden: 0,
  avgEarnedRate: 12.4, minEarnedRate: 1.2, ratesKnown: 5, platinumEarnedRate: 4.3, approximate: false, dlc: { required: 12, earned: 5, remaining: 7 },
};
const DLC_LINE = 'DLC: 5 из 12, платине не мешают';

// базовые трофеи (default / null) и два DLC; порядок в списке «как в игре» не меняется
const withGroups = () => trophyList().map((t, i) => ({ ...t, groupId: i === 2 ? '001' : i === 4 ? '002' : i === 5 ? null : 'default' }));

async function setup(page: Page, context: import('@playwright/test').BrowserContext, baseURL: string, forecast: Record<string, unknown>) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  // на мобильном «Ближе к платине» по умолчанию свёрнут: здесь проверяем содержимое карточек
  await context.addInitScript(() => localStorage.setItem('ps-near-open', '1'));
  const m = await mockApi(page, seed());
  m.forecasts[3] = forecast;
  m.nearPlatinum = [{ id: 3, forecast }, { id: 4, forecast: { ...forecast, dlc: null } }];
  m.trophies[3] = withGroups() as never;
  return m;
}

test.describe('Фаза 36: DLC', () => {
  test('окно игры: строка DLC без «≈» при approximate=false; трофеи разделены на основную игру и дополнения', async ({ page, context, baseURL }) => {
    const m = await setup(page, context, baseURL!, FORECAST);
    // пакет 5: название из PSN у 001, у 002 нет — «Дополнение 2»
    m.trophyGroups = { 3: [{ setId: 1, groupId: '001', name: 'Кровавые узы', iconUrl: null }] };
    await page.goto('/?game=3');
    const dlg = page.getByRole('dialog');
    const sec = dlg.getByRole('region', { name: 'Путь к платине' });
    await expect(sec).toContainText(DLC_LINE);
    await expect(sec).not.toContainText('≈');
    await expect(sec).not.toContainText('Приблизительно');
    await dlg.getByRole('tab', { name: /Трофеи/ }).click();
    const secs = dlg.getByTestId('trophy-section');
    await expect(secs).toHaveCount(3);
    await expect(secs.locator('h3')).toHaveText(['Основная игра 2/4', 'Кровавые узы 1/1', 'Дополнение 2 1/1']);
    await expect(secs.nth(0)).not.toHaveAttribute('data-dlc');
    await expect(secs.nth(1)).toHaveAttribute('data-dlc', 'true');
    await expect(secs.nth(1).getByRole('heading', { name: /Кровавые узы/ })).toBeVisible();
    const rows = dlg.locator('li.ps-trophy');
    await expect(rows).toHaveCount(6);
    // основная игра: 0, 1, 3, 5 (group null = база), внутри порядок «как в игре»
    for (const [i, name] of ['Легенда', 'Трофей 1', 'Скрытый трофей', 'Трофей 5'].entries()) await expect(secs.nth(0).locator('li.ps-trophy').nth(i).locator('.ps-trophy__name')).toContainText(name);
    await expect(secs.nth(0).locator('.ps-trophy__dlc')).toHaveCount(0);
    await expect(secs.nth(1).locator('li.ps-trophy')).toContainText('Трофей 2');
    await expect(secs.nth(2).locator('li.ps-trophy')).toContainText('Трофей 4');
    await expect(dlg.locator('.ps-trophy__dlc')).toHaveCount(2);
    await expect(secs.nth(1).locator('li.ps-trophy')).toHaveAttribute('aria-label', /, DLC/);
    // скрытые помечены «Скрытый» (полученный и не полученный)
    await expect(dlg.locator('.ps-trophy__hidtag')).toHaveCount(2);
    await expect(secs.nth(2).locator('li.ps-trophy')).toHaveAttribute('aria-label', /, скрытый/);
    // фильтр «Получены»: пустых разделов нет, счётчик раздела по полному списку
    await dlg.getByRole('group', { name: 'Фильтр трофеев' }).getByRole('button', { name: /Получен/ }).click();
    await expect(secs.locator('h3')).toHaveText(['Основная игра 2/4', 'Кровавые узы 1/1', 'Дополнение 2 1/1']);
    await dlg.getByRole('group', { name: 'Фильтр трофеев' }).getByRole('button', { name: /Не получен/ }).click();
    await expect(secs.locator('h3')).toHaveText(['Основная игра 2/4']);
    await noOverflow(page);
  });

  test('approximate=true и dlc=null: «≈» есть, строки DLC нет, DLC-пометок нет', async ({ page, context, baseURL }) => {
    const m = await setup(page, context, baseURL!, { ...FORECAST, approximate: true, dlc: null });
    m.trophies[3] = trophyList() as never;
    await page.goto('/?game=3');
    const sec = page.getByRole('dialog').getByRole('region', { name: 'Путь к платине' });
    await expect(sec).toContainText('≈');
    await expect(sec).not.toContainText('DLC:');
    await page.getByRole('dialog').getByRole('tab', { name: /Трофеи/ }).click();
    await expect(page.locator('.ps-trophy__dlc')).toHaveCount(0);
  });

  test('«Ближе всего к платине»: строка DLC только у карточки с dlc, «≈» нет; 320 и 412, 7 тем', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!, FORECAST);
    await page.goto('/');
    const items = page.locator('#near-platinum .ps-near');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText(DLC_LINE);
    await expect(items.first()).not.toContainText('≈');
    await expect(items.first()).toHaveAttribute('aria-label', /DLC: 5 из 12, платине не мешают$/);
    await expect(items.nth(1)).not.toContainText('DLC');
    for (const w of [320, 412]) {
      await page.setViewportSize({ width: w, height: 800 });
      await noOverflow(page);
      const box = await items.first().boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(112);
      expect(await items.first().locator('.ps-near__dlc').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    for (const t of THEMES) {
      await setTheme(page, t);
      const c = await items.first().locator('.ps-near__dlc').evaluate((el) => getComputedStyle(el).color);
      expect(c).not.toBe('rgba(0, 0, 0, 0)');
    }
  });
});
