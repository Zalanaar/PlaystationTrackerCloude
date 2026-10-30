// QA правки 1 и 2: блок «Игры-сервисы» и оценочные столбцы на узких экранах (320/360/390) и в трёх темах. Снимки при SHOTS_DIR.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed, serviceGames, type G } from './collection-mock';
import { signedSession } from './session';
import { setView } from './view';

const SHOTS = process.env.SHOTS_DIR;
const WIDTHS = [320, 360, 390];
const THEMES = ['night', 'graphite', 'ps5'] as const;
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** Элементы внутри селектора, выходящие за край вьюпорта (вне прокручиваемых контейнеров). */
const blockOverflow = (page: Page, sel: string) =>
  page.evaluate((q) => {
    const W = document.documentElement.clientWidth;
    const root = document.querySelector(q)!;
    const clipped = (el: Element) => {
      for (let a = el.parentElement; a && a !== root.parentElement; a = a.parentElement) {
        const o = getComputedStyle(a).overflowX;
        if (o === 'auto' || o === 'hidden' || o === 'scroll' || o === 'clip') return true;
      }
      return false;
    };
    return [...root.querySelectorAll('*')].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > W + 1 || b.left < -1) && !clipped(el); }).length;
  }, sel);
async function theme(page: Page, t: (typeof THEMES)[number]) {
  await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
}
async function login(context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
}

const longTitles = (list: G[]): G[] => list.map((g, i) => ({ ...g, title: i % 3 === 0 ? `Очень длинное название игры-сервиса без пробелов ${'W'.repeat(60)} ${i}` : g.title }));

test('BUG-E2: Коллекция на 360px без горизонтального скролла документа (панель фильтров, ряд 2)', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(context, baseURL!);
  await mockApi(page, seed());
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Фильтры и сортировка/ })).toBeVisible(); // Фаза 18: ряд 2 заменён кнопкой «Фильтры»
  await page.waitForTimeout(500);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test.describe('QA: блок «Игры-сервисы» на узких экранах', () => {
  for (const w of WIDTHS) {
    test(`${w}px: 120 сервисов с длинными названиями, нет горизонтального скролла, раскрытие/сворачивание`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await login(context, baseURL!);
      await mockApi(page, [...seed(), ...longTitles(serviceGames(120))]);
      await page.goto('/');
      const block = page.locator('#service');
      await expect(block).toBeVisible();
      await expect(block.locator('.ps-block__cnt')).toHaveText('120');
      // Документ целиком на 320/360 шире экрана из-за панели фильтров (BUG-E2, не блок сервисов): проверяем сам блок.
      expect(await blockOverflow(page, '#service')).toBe(0);
      if (w >= 390) expect(await overflow(page)).toBeLessThanOrEqual(0);
      const toggle = block.getByTestId('service-toggle');
      await expect(toggle).toBeVisible();
      const box = await toggle.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(w);
      expect(box!.height).toBeGreaterThanOrEqual(40);
      await toggle.click();
      await expect(toggle).toHaveText('Свернуть');
      expect(await blockOverflow(page, '#service')).toBe(0);
      for (const t of THEMES) {
        await theme(page, t);
        await block.scrollIntoViewIfNeeded();
        if (SHOTS) await block.screenshot({ path: `${SHOTS}/svc-${w}-${t}.png` });
      }
      await toggle.click();
    });
  }

  test('режим «Список»: сервисы по 5 строк, «Показать ещё» по 10, без h-скролла на 320', async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await login(context, baseURL!);
    await mockApi(page, [...seed(), ...longTitles(serviceGames(30))]);
    await page.goto('/');
    await setView(page, 'Список');
    const block = page.locator('#service');
    await expect(block).toBeVisible();
    expect(await blockOverflow(page, '#service')).toBe(0);
    if (SHOTS) await block.screenshot({ path: `${SHOTS}/svc-list-320.png` });
  });
});

const z = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };
function statsPayload() {
  const byMonth = [210.4, 198.3, 1234.5, 0, 12.1, 0.1, 55.5, 80, 3, 40, 99.9, null];
  const est = [210.4, 198.3, 500, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  return {
    period: { type: 'year', year: 2026, month: null, from: '2026-01-01', to: '2026-12-31', fromUtc: '2025-12-31T21:00:00.000Z', toUtc: '2026-12-31T21:00:00.000Z' },
    years: [2026, 2025],
    header: { completed: 0, dropped: 0, hours: 1933.8, platinum: 0 },
    hours: { byMonth, estimatedByMonth: est, estimatedHours: 908.7, hasEstimate: true, firstSnapshotDate: '2026-03-04', periodPartial: true },
    genres: { hasData: false, items: [], games: {} }, top: { byHours: [], byTrophies: [] },
    trophies: { counts: z, byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...z })) },
    finished: { groups: [] },
    played: { games: {}, groups: [] },
  };
}

test.describe('QA: оценочные часы в Статистике на узких экранах', () => {
  for (const w of WIDTHS) {
    test(`${w}px: стек real/est, легенда, плашка, подсказка по тапу, нет h-скролла, 3 темы`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await login(context, baseURL!);
      await mockApi(page);
      await page.route(/\/api\/stats\?/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: statsPayload() }) }));
      await page.goto('/stats');
      const bars = page.locator('.ps-st-bar');
      await expect(bars).toHaveCount(12);
      await expect(page.getByRole('list', { name: 'Обозначения' })).toContainText('Оценка');
      await expect(page.getByRole('note')).toContainText('часы оценены');
      await expect(page.locator('.ps-st-head')).toContainText('≈');
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      // март (1234.5 из них 500 оценка): подсказка внутри экрана
      await bars.nth(2).click();
      const tip = page.getByRole('tooltip');
      await expect(tip).toContainText('Оценка: 500 ч');
      const tb = await tip.boundingBox();
      expect(tb!.x).toBeGreaterThanOrEqual(-0.5);
      expect(tb!.x + tb!.width).toBeLessThanOrEqual(w + 0.5);
      await bars.nth(0).click();
      expect((await page.getByRole('tooltip').boundingBox())!.x).toBeGreaterThanOrEqual(-0.5);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      for (const t of THEMES) {
        await theme(page, t);
        if (SHOTS) await page.locator('.ps-st-panel--hours, .ps-st-panel--hours-wide').first().screenshot({ path: `${SHOTS}/est-${w}-${t}.png` });
      }
    });
  }
});

test('BUG-E3: подсказка столбца «Ноя» не выходит за правый край на 320px', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await login(context, baseURL!);
  await mockApi(page);
  await page.route(/\/api\/stats\?/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: statsPayload() }) }));
  await page.goto('/stats');
  await page.locator('.ps-st-bar').nth(10).click();
  const b = await page.getByRole('tooltip').boundingBox();
  expect(b!.x + b!.width).toBeLessThanOrEqual(320.5);
});
