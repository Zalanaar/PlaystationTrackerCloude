// П11.4 мини-итоги месяца в «Играх месяца»: часы месяца, трофеи и главная игра с долей; телефон 360 без горизонтального скролла.
import { test, expect } from '@playwright/test';
import { open, TODAY } from './stats-mock';

test('мини-итоги марта: часы, трофеи, главная игра', async ({ page, context, baseURL }) => {
  test.skip(TODAY.month < 3, 'в моке часы есть только у прошедших месяцев');
  await open(page, context, baseURL!, `/stats?period=month&year=${TODAY.year}&month=3`);
  const sum = page.locator('#st-played-sec').getByTestId('month-summary');
  // в моке часы игры (12,5) больше часов месяца (12): доля > 100 % не показывается
  await expect(sum).toHaveText('12 ч за месяц · 14 трофеев, 2 платины · больше всего — Игра Один (12 ч 30 м)');
});

test('360 px: строка переносится без горизонтального скролла', async ({ page, context, baseURL, isMobile }) => {
  test.skip(!isMobile || TODAY.month < 3, 'телефон');
  await page.setViewportSize({ width: 360, height: 800 });
  await open(page, context, baseURL!, `/stats?period=month&year=${TODAY.year}&month=3`);
  const sum = page.locator('#st-played-sec').getByTestId('month-summary');
  await sum.scrollIntoViewIfNeeded();
  await expect(sum).toBeVisible();
  const b = (await sum.boundingBox())!;
  expect(b.x + b.width).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
