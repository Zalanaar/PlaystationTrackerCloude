// П15.1: «Обзор» окна игры в две колонки на широком экране (слева прогресс/оценка/история, справа даты и управление);
// ниже 1100 px — одна колонка в прежнем порядке. API эмулируется (collection-mock).
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

async function open(page: Page, baseURL: string, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, seed());
  await page.goto('/?game=4');
  const d = page.getByRole('dialog', { name: 'God of War' });
  await expect(d.getByTestId('game-review')).toBeVisible();
  return d;
}
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;
/** Обе рамки за один кадр: на телефоне окно въезжает снизу, и раздельные замеры попадали в разные кадры анимации (флак CI). */
const boxes = (page: Page, a: string, b: string) => page.evaluate(([sa, sb]) => {
  const r = (s: string) => { const e = document.querySelector(s)!.getBoundingClientRect(); return { x: e.x, y: e.y, width: e.width, height: e.height }; };
  return [r(sa), r(sb)] as const;
}, [a, b] as const);
const settle = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().map((x) => x.finished.catch(() => null))));
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('1280 px: оценка слева, «Даты» справа на одной высоте; без горизонтальной прокрутки', async ({ page, baseURL }, info) => {
  test.skip(info.project.name !== 'desktop', 'раскладка десктопа');
  const d = await open(page, baseURL!, 1280, 800);
  await expect(d.getByRole('heading', { name: 'Даты' })).toBeVisible();
  await settle(page);
  const [review, dates] = await boxes(page, '[data-testid="game-review"]', '.ps-gd__ovside .ps-gd__sec');
  expect(dates.x).toBeGreaterThan(review.x + review.width - 1);
  expect(Math.abs(dates.y - (await box(page, '.ps-gd__ovmain > *')).y)).toBeLessThan(4);
  expect(review.width).toBeGreaterThan(dates.width);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

for (const [w, h] of [[1024, 768], [390, 844]] as const) {
  test(`${w} px: одна колонка, «Даты» под оценкой`, async ({ page, baseURL }, info) => {
    test.skip(info.project.name === 'webkit-iphone', 'хватает chromium');
    const d = await open(page, baseURL!, w, h);
    await expect(d.getByRole('heading', { name: 'Даты' })).toBeAttached();
    await settle(page);
    const [review, dates] = await boxes(page, '[data-testid="game-review"]', '.ps-gd__ovside .ps-gd__sec');
    expect(dates.y).toBeGreaterThan(review.y + review.height - 1);
    expect(Math.abs(dates.x - review.x)).toBeLessThan(2);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
}
