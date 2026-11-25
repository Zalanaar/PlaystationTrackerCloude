// Сворачиваемый блок «Сегодня» на главной: одна строка под шапкой, фильтры сразу под ним,
// повод в той же линии (высота не растёт), состояние в cookie, 390 + desktop, темы.
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';
import { expandToday } from './today';

const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'] as const;

async function openHome(page: Page, baseURL: string, openCookie?: '0' | '1') {
  const cookies = [{ name: 'pst_session', value: await signedSession(), url: baseURL }];
  if (openCookie) cookies.push({ name: 'ps-today-open', value: openCookie, url: baseURL });
  await page.context().addCookies(cookies);
  await mockApi(page);
  await page.goto('/');
}

test.describe('Сегодня', () => {
  test('по умолчанию свёрнут: строка под шапкой, фильтры сразу, карточки скрыты', async ({ page, baseURL }) => {
    await openHome(page, baseURL!);
    const bar = page.getByTestId('today-toggle');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('aria-expanded', 'false');
    await expect(bar).toContainText('Сегодня');
    const panel = page.locator('#today-panel');
    await expect(panel).toBeHidden();
    const barBox = await bar.boundingBox();
    const headBox = await page.locator('.ps-pagehead').boundingBox();
    const filters = page.getByRole('group', { name: 'Статус' });
    await expect(filters).toBeVisible();
    const filterBox = await filters.boundingBox();
    expect(barBox).toBeTruthy();
    expect(headBox).toBeTruthy();
    expect(filterBox).toBeTruthy();
    expect(barBox!.y).toBeGreaterThan(headBox!.y);
    expect(barBox!.height).toBeLessThanOrEqual(44);
    // фильтры сразу под строкой и рядом обложек «Играю» (П.1), не после высокого hero
    const strip = page.getByTestId('playing-strip');
    await expect(strip).toBeVisible();
    const stripBox = (await strip.boundingBox())!;
    const bar2 = (await bar.boundingBox())!;
    expect(stripBox.height).toBeLessThanOrEqual(56);
    expect(stripBox.y).toBeGreaterThanOrEqual(bar2.y + bar2.height);
    const filter2 = (await filters.boundingBox())!;
    expect(filter2.y).toBeGreaterThan(bar2.y);
    // на десктопе между ними ещё строка поиска (44 px + отступы)
    expect(filter2.y - (stripBox.y + stripBox.height)).toBeLessThan(110);
    await expect(page.getByTestId('week1')).toBeHidden();
  });

  test('П.1: обложки «Играю» видны в свёрнутом виде, тап открывает игру; в раскрытом — только hero', async ({ page, baseURL }) => {
    await openHome(page, baseURL!);
    const strip = page.getByTestId('playing-strip');
    await expect(strip.getByRole('button')).not.toHaveCount(0);
    await strip.getByRole('button').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expandToday(page);
    await expect(strip).toHaveCount(0);
  });

  test('П.3: «Разбор N» рядом со строкой ведёт в очередь; П.10: 1–2 подсказки статусов, статус — вручную в окне игры', async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    const m = await mockApi(page);
    m.hints = [
      { gameId: 6, rule: 'started', currentStatus: 'backlog' },
      { gameId: 1, rule: 'stale', currentStatus: 'playing' },
      { gameId: 2, rule: 'started', currentStatus: null },
    ];
    await page.goto('/');
    const tri = page.getByTestId('today-triage');
    await expect(tri).toBeVisible();
    await expect(tri).toHaveAttribute('href', '/triage');
    await expect(tri).toContainText(/Разбор\s*\d+/);
    expect((await tri.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expandToday(page);
    const hints = page.getByTestId('today-hint');
    await expect(hints).toHaveCount(2);
    await expect(page.getByTestId('today-hints')).toContainText('Все подсказки: 3');
    const before = m.mutations.length;
    await hints.first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(m.mutations.length).toBe(before); // сам статус не меняется
  });

  test('раскрытие показывает карточки; cookie помнит состояние', async ({ page, baseURL, context }) => {
    await openHome(page, baseURL!);
    await expandToday(page);
    await expect(page.locator('#today-panel')).toBeVisible();
    expect((await context.cookies()).find((c) => c.name === 'ps-today-open')?.value).toBe('1');
    await page.reload();
    await expect(page.getByTestId('today-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#today-panel')).toBeVisible();
  });

  test('cookie 1: сразу раскрыт в первом HTML (без вспышки свёртки)', async ({ page, baseURL }) => {
    await openHome(page, baseURL!, '1');
    await expect(page.getByTestId('today-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#today-panel')).toBeVisible();
  });

  test('повод не увеличивает высоту строки', async ({ page, baseURL }) => {
    await openHome(page, baseURL!);
    const bar = page.getByTestId('today-toggle');
    await expect(bar).toBeVisible();
    const h1 = (await bar.boundingBox())!.height;
    await page.waitForTimeout(400);
    const h2 = (await bar.boundingBox())!.height;
    expect(h2).toBe(h1);
    expect(h2).toBeLessThanOrEqual(44);
  });
});

for (const w of [390, 1280]) {
  test(`ширина ${w}: строка и страница без горизонтального скролла, все темы`, async ({ page, baseURL }, testInfo) => {
    if (w === 390 && !testInfo.project.name.includes('mobile') && testInfo.project.name !== 'webkit-iphone') {
      await page.setViewportSize({ width: 390, height: 800 });
    }
    if (w === 1280) await page.setViewportSize({ width: 1280, height: 800 });
    await openHome(page, baseURL!);
    const bar = page.getByTestId('today-toggle');
    await expect(bar).toBeVisible();
    for (const t of THEMES) {
      await page.evaluate((v) => {
        if (v === 'night') document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', v);
      }, t);
      await page.waitForTimeout(200);
      expect(await bar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    }
  });
}
