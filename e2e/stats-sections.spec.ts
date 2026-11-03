// D-P5 (пакет 3): липкие чипы разделов Статистики. Тап прокручивает к разделу так, что заголовок не прячется под шапкой
// и полосой; при прокрутке подсвечивается текущий; полоса прилипает; ссылка «Вся лента трофеев» ведёт в /trophies.
import { test, expect } from '@playwright/test';
import { open } from './stats-mock';

test('чипы разделов: только существующие, тап прокручивает, подсветка, липкость', async ({ page, context, baseURL }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, context, baseURL!);
  const bar = page.getByTestId('stats-sections');
  await expect(page.getByRole('heading', { name: 'Часы по месяцам' })).toBeVisible();
  const chips = bar.locator('a, button');
  await expect(chips.first()).toBeVisible();
  const labels = await chips.allInnerTexts();
  expect(labels.slice(0, 2)).toEqual(['Часы', 'Жанры']);
  expect(labels).toContain('Трофеи');
  await expect(bar.locator('[aria-current="true"]')).toHaveText('Часы');
  const y0 = (await bar.boundingBox())!.y;

  await bar.getByText('Трофеи', { exact: true }).click();
  const h = page.getByRole('heading', { name: 'Трофеи', exact: true });
  await expect.poll(async () => (await h.boundingBox())!.y).toBeGreaterThan(0);
  const barBox = (await bar.boundingBox())!;
  const hBox = (await h.boundingBox())!;
  // заголовок раздела виден под полосой (не перекрыт)
  expect(hBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);
  expect(hBox.y).toBeLessThan(barBox.y + barBox.height + 120);
  // полоса прилипла под шапкой
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect(barBox.y).toBeLessThanOrEqual(y0);
  expect(barBox.y).toBeGreaterThanOrEqual(0);
  await expect(bar.locator('[aria-current="true"]')).toHaveText('Трофеи');

  // ручная прокрутка вверх возвращает подсветку на первый раздел
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(bar.locator('[aria-current="true"]')).toHaveText('Часы');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('ссылка «Вся лента трофеев» из панели Трофеи ведёт в ленту', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!);
  await page.route(/\/api\/trophies\/feed(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { period: '7d', rare: false, today: '2026-11-03', summary: { total: 0, platinum: 0, gold: 0, silver: 0, bronze: 0 }, items: [], nextCursor: null } }) }));
  const link = page.getByTestId('stats-feed-link').first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/trophies$/);
  await expect(page.getByTestId('tfeed-empty')).toBeVisible();
});
