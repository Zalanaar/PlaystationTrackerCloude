// Пакет 6, п. 9: «Почти платина» на /trophies — полный список (больше 5), переход из блока «Ближе всего к платине» на Коллекции
// (сам блок остаётся с 5 играми), переключатель «Лента / Почти платина» помнит раздел в URL, строка открывает окно игры на «Трофеях».
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

const forecast = (progress: number, o: Record<string, unknown> = {}) => ({
  setId: 1, required: 50, earned: Math.floor(progress / 2), progress, remaining: { gold: 1, silver: 0, bronze: 50 - Math.floor(progress / 2) - 1, total: 50 - Math.floor(progress / 2) },
  remainingHidden: 0, avgEarnedRate: 12.4, minEarnedRate: 1.2, ratesKnown: 5, platinumEarnedRate: 4.3, approximate: false, dlc: null, ...o,
});

/** 9 игр: id 3 — из seed (есть на Коллекции), остальные только в списке. */
const nearItems = () => [
  { gameId: 3, title: 'Horizon Forbidden West', coverUrl: null, forecast: forecast(96, { approximate: true }) },
  ...Array.from({ length: 8 }, (_, i) => ({ gameId: 200 + i, title: `Игра ${i + 1}`, coverUrl: null, forecast: forecast(90 - i * 10, i === 0 ? { dlc: { required: 12, earned: 5, remaining: 7 } } : {}) })),
];

async function setup(page: Page, context: BrowserContext, baseURL: string, o: { items?: ReturnType<typeof nearItems>; delay?: number } = {}) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const m = await mockApi(page, seed());
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
  const calls: string[] = [];
  const items = o.items ?? nearItems();
  await page.route(/\/api\/trophies\/near(\?|$)/, async (r) => {
    calls.push(r.request().url());
    if (o.delay) await new Promise((ok) => setTimeout(ok, o.delay));
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { items } }) });
  });
  await page.route(/\/api\/trophies\/feed(\?|$)/, (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, data: { period: '7d', rare: false, today: '2026-11-10', summary: { total: 0, platinum: 0, gold: 0, silver: 0, bronze: 0 }, items: [], nextCursor: null } }),
  }));
  return { m, calls, items };
}

test('блок на Коллекции остаётся (5 игр), «Все» ведёт в полный список', async ({ page, context, baseURL }) => {
  await context.addInitScript(() => localStorage.setItem('ps-near-open', '1'));
  const { m, items } = await setup(page, context, baseURL!);
  m.nearPlatinum = [{ id: 3, forecast: items[0].forecast }, { id: 4, forecast: items[1].forecast }];
  await page.goto('/');
  const block = page.locator('#near-platinum');
  await expect(block.locator('.ps-near')).toHaveCount(2);
  const all = block.getByTestId('near-all');
  await expect(all).toHaveAttribute('href', '/trophies?view=near');
  const box = (await all.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await all.click();
  await expect(page).toHaveURL(/\/trophies\?view=near$/);
  await expect(page.getByTestId('tnear-row')).toHaveCount(items.length);
  await expect(page.getByTestId('tnear-summary')).toHaveText(`${items.length} игр с прогрессом к платине`);
});

test('строки: прогресс, остаток, редкость, DLC, «≈»; тап открывает окно игры на «Трофеях»', async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!);
  await page.goto('/trophies?view=near');
  const rows = page.getByTestId('tnear-row');
  await expect(rows).toHaveCount(9);
  await expect(page.getByTestId('tf-view-near')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Период и редкость' })).toHaveCount(0);
  await expect(rows.first()).toContainText('Horizon Forbidden West');
  await expect(rows.first().getByTestId('tnear-progress')).toHaveText('≈ 96%');
  await expect(rows.first()).toContainText('Осталось 2');
  await expect(rows.first()).toContainText('ср. редкость 12,4%');
  await expect(rows.nth(1)).toContainText('DLC: 5 из 12, платине не мешают');
  await expect(rows.nth(1).getByTestId('tnear-progress')).toHaveText('90%');
  await expect(rows.first().locator('a')).toHaveAttribute('aria-label', /^Horizon Forbidden West\. Прогресс к платине примерно 96%/);
  // без горизонтальной прокрутки; строка не ниже тап-зоны
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect((await rows.first().locator('a').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await rows.first().locator('a').click();
  await expect(page).toHaveURL(/\/\?game=3&tab=trophies$/);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('переключатель «Лента / Почти платина»: URL, перезагрузка, один запрос за вход', async ({ page, context, baseURL }) => {
  const s = await setup(page, context, baseURL!);
  await page.goto('/trophies?period=all');
  await expect(page.getByRole('group', { name: 'Период и редкость' })).toBeVisible();
  await page.getByTestId('tf-view-near').click();
  await expect(page).toHaveURL(/\/trophies\?view=near$/);
  await expect(page.getByTestId('tnear-row')).toHaveCount(9);
  expect(s.calls).toHaveLength(1);
  await page.reload();
  await expect(page.getByTestId('tf-view-near')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tnear-row')).toHaveCount(9);
  await page.getByRole('button', { name: 'Лента', exact: true }).click();
  await expect(page).toHaveURL(/\/trophies$/);
  await expect(page.getByTestId('tfeed-empty')).toBeVisible();
  await expect(page.getByRole('button', { name: '7 дней', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('пустой список: подсказка; данные позже — переключатель на месте', async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!, { items: [], delay: 800 });
  await page.goto('/trophies?view=near');
  const sw = page.getByTestId('tf-view');
  await sw.waitFor();
  const before = (await sw.boundingBox())!;
  await expect(page.getByTestId('tnear-empty')).toBeVisible();
  await expect(page.getByTestId('tnear-summary')).toHaveText('0 игр с прогрессом к платине');
  const after = (await sw.boundingBox())!;
  expect(Math.abs(after.y - before.y)).toBeLessThan(0.5);
});
