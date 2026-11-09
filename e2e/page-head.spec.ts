// Пакет 6, п. 6: одна шапка страниц на мобильном — от шапки страницы до первого блока 12 px на всех вкладках,
// пустой шапки (только скрытый h1) нет. API эмулируется (e2e/collection-mock.ts, roadmap-mock.ts).
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';
import { baseState, mockRoadmap } from './roadmap-mock';

const GAP = 12;

/** Шапка страницы (видимая) и первый видимый блок после неё. */
async function head(page: Page) {
  return page.evaluate(() => {
    const ph = [...document.querySelectorAll('.ps-pagehead')].find((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0) ?? null;
    if (!ph) return null;
    const r = ph.getBoundingClientRect();
    let nx = ph.nextElementSibling;
    while (nx && nx.getBoundingClientRect().height === 0) nx = nx.nextElementSibling;
    return { display: getComputedStyle(ph).display, top: r.top, bottom: r.bottom, height: r.height, nextTop: nx ? nx.getBoundingClientRect().top : null };
  });
}

const PAGES: { path: string; ready: (p: Page) => Promise<void> }[] = [
  { path: '/', ready: (p) => p.locator('.ps-profile').first().waitFor() },
  { path: '/backlog', ready: (p) => p.getByTestId('bl-total').waitFor() },
  { path: '/roadmap', ready: (p) => p.getByText('Неделя с понедельника', { exact: true }).waitFor() },
  { path: '/trophies', ready: (p) => p.locator('.ps-tf__sum').first().waitFor() },
  { path: '/wrapped', ready: (p) => p.locator('.ps-wrapped-lead').first().waitFor() },
];

test.describe('Пакет 6, п. 6: шапка страниц (мобильный)', () => {
  test.beforeEach(async ({ page, context, baseURL, isMobile }) => {
    test.skip(!isMobile, 'мобильная раскладка');
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    await mockApi(page, seed());
    await mockRoadmap(page, baseState());
    await page.route(/\/api\/recommend(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { items: [], meta: { llm: 'disabled', candidates: 0, time: 'any' } } }) }));
    await page.route(/\/api\/recommend\/dislikes$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { items: [], ttlDays: 30 } }) }));
  });

  for (const { path, ready } of PAGES) {
    test(`${path}: от шапки страницы до первого блока ${GAP} px`, async ({ page }) => {
      await page.goto(path);
      await ready(page);
      await expect.poll(async () => {
        const h = await head(page);
        return h && h.nextTop !== null ? Math.round(h.nextTop - h.bottom) : null;
      }).toBe(GAP);
    });
  }

  test('/recommend: пустой шапки нет, режимы сразу под подвкладками (как первый ряд на Бэклоге и Плане)', async ({ page }) => {
    await page.goto('/recommend');
    const modes = page.locator('.ps-rec-modes');
    await modes.waitFor();
    await expect(page.getByRole('heading', { name: 'Подскажи', level: 1 })).toBeAttached();
    const m = await page.evaluate(() => ({
      sub: [...document.querySelectorAll('.ps-subnav')].find((e) => e.getBoundingClientRect().height > 0)!.getBoundingClientRect().bottom,
      modes: document.querySelector('.ps-rec-modes')!.getBoundingClientRect().top,
      display: getComputedStyle(document.querySelector('.ps-rec-head')!).display,
    }));
    expect(m.display).toBe('contents');
    await page.goto('/roadmap');
    await page.getByText('Неделя с понедельника', { exact: true }).waitFor();
    const rm = await page.evaluate(() => ({
      sub: [...document.querySelectorAll('.ps-subnav')].find((e) => e.getBoundingClientRect().height > 0)!.getBoundingClientRect().bottom,
      head: document.querySelector('.ps-rm-page .ps-pagehead')!.getBoundingClientRect().top,
    }));
    expect(Math.round(m.modes - m.sub)).toBe(Math.round(rm.head - rm.sub));
  });
});
