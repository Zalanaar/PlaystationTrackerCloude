// Пакет 4, мобильная полировка: вкладки окна игры по центру, кнопка «Наверх», без повторного заголовка раздела.
// Мобильный (Pixel 7) и WebKit iPhone; на десктопе всё как было. API эмулируется (e2e/collection-mock.ts).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed, trophyList, type G, type MockTrophy } from './collection-mock';
import { signedSession } from './session';
import { open as openStats } from './stats-mock';
import { baseState, mockRoadmap } from './roadmap-mock';

function many(): G[] {
  const extra: G[] = Array.from({ length: 50 }, (_, i) => ({
    id: 200 + i, title: `Игра ${i + 1}`, lastPlayedAt: new Date(Date.UTC(2026, 8, 28 - (i % 28), 10)).toISOString(), status: 'backlog' as const,
    completedAt: null, droppedAt: null, playSeconds: 3600 * (i + 1), playCount: 2, trophies: null,
  }));
  return [...seed(), ...extra];
}
const manyTrophies = (): MockTrophy[] => [...trophyList(), ...Array.from({ length: 50 }, (_, i) => ({ ...trophyList()[5], trophyId: 10 + i, name: `Трофей ${10 + i}` }))];

async function login(page: Page, context: BrowserContext, baseURL: string, games?: G[]) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  return mockApi(page, games);
}
const totop = (page: Page) => page.getByRole('button', { name: 'Наверх' });

test.describe('окно игры: вкладки', () => {
  test('мобильный: равные колонки по центру, подчёркивание под своей вкладкой; десктоп без изменений', async ({ page, context, baseURL, isMobile }) => {
    await login(page, context, baseURL!);
    await page.goto('/?game=3');
    const d = page.getByRole('dialog', { name: 'Horizon Forbidden West' });
    const tabs = d.getByRole('tab');
    await expect(d.getByRole('tab', { name: /Трофеи/ })).toBeVisible();
    const m = await d.getByRole('tablist').evaluate((list) => {
      const boxes = [...list.querySelectorAll('[role="tab"]')].map((t) => t.getBoundingClientRect());
      const sel = list.querySelector('[aria-selected="true"]')!;
      const after = getComputedStyle(sel, '::after');
      const r = list.getBoundingClientRect();
      return {
        display: getComputedStyle(list).display, widths: boxes.map((b) => b.width), left: boxes[0].left - r.left, right: r.right - boxes[boxes.length - 1].right,
        afterW: parseFloat(after.width), selW: sel.getBoundingClientRect().width, tops: boxes.map((b) => Math.round(b.top)),
      };
    });
    expect(await tabs.count()).toBeGreaterThanOrEqual(2);
    if (!isMobile) {
      expect(m.display).toBe('flex');
      return;
    }
    expect(new Set(m.tops).size).toBe(1); // один ряд
    for (const w of m.widths) expect(Math.abs(w - m.widths[0])).toBeLessThan(1);
    expect(Math.abs(m.left - m.right)).toBeLessThan(1);
    expect(Math.abs(m.afterW - m.selW)).toBeLessThan(1);
    // текст последней вкладки не уходит под липкий ✕
    const gap = await d.evaluate((root) => {
      const tabs = root.querySelectorAll('[role="tab"]');
      const r = document.createRange();
      r.selectNodeContents(tabs[tabs.length - 1]);
      return root.querySelector('.ps-gd__close')!.getBoundingClientRect().left - r.getBoundingClientRect().right;
    });
    expect(gap).toBeGreaterThan(0);
    // на самом узком iPhone (375) «Трофеи N/M» помещается в свою колонку
    await page.setViewportSize({ width: 375, height: 667 });
    const fits = await d.getByRole('tab', { name: /Трофеи/ }).evaluate((t) => t.scrollWidth <= t.clientWidth + 1);
    expect(fits).toBe(true);
  });
});

test.describe('кнопка «Наверх»', () => {
  test('появляется после экрана прокрутки, 44 px над таббаром, плавно наверх; на десктопе нет', async ({ page, context, baseURL, isMobile }) => {
    await login(page, context, baseURL!, many());
    await page.goto('/backlog');
    await expect(page.getByRole('button', { name: /^Открыть: Игра 1$/ }).first()).toBeVisible();
    await expect(totop(page)).toHaveCount(0);
    const vh = await page.evaluate(() => window.innerHeight);
    await page.evaluate((y) => window.scrollTo(0, y), Math.round(vh * 1.5));
    if (!isMobile) {
      await page.waitForTimeout(300);
      await expect(totop(page)).toHaveCount(0);
      return;
    }
    await expect(totop(page)).toBeVisible();
    const g = await totop(page).evaluate((b) => {
      const r = b.getBoundingClientRect();
      const bar = document.querySelector('.ps-tabbar')!.getBoundingClientRect();
      return { w: r.width, h: r.height, bottom: r.bottom, right: window.innerWidth - r.right, barTop: bar.top, pos: getComputedStyle(b).position };
    });
    expect(g.pos).toBe('fixed');
    expect(g.w).toBeGreaterThanOrEqual(44);
    expect(g.h).toBeGreaterThanOrEqual(44);
    expect(g.bottom).toBeLessThanOrEqual(g.barTop);
    expect(g.right).toBeLessThan(40);
    await totop(page).click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(totop(page)).toHaveCount(0);
  });

  test('prefers-reduced-motion: прокрутка мгновенная', async ({ page, context, baseURL, isMobile }) => {
    test.skip(!isMobile, 'только мобильный');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await login(page, context, baseURL!, many());
    await page.goto('/backlog');
    await expect(page.getByRole('button', { name: /^Открыть: Игра 1$/ }).first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.5));
    await totop(page).click();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('не перекрывает sheet: при открытом «Меню» кнопки нет', async ({ page, context, baseURL, isMobile }) => {
    test.skip(!isMobile, 'только мобильный');
    await login(page, context, baseURL!, many());
    await page.goto('/backlog');
    await expect(page.getByRole('button', { name: /^Открыть: Игра 1$/ }).first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.5));
    await expect(totop(page)).toBeVisible();
    await page.evaluate(() => {
      const s = document.createElement('div');
      s.className = 'ps-sheet-wrap';
      s.id = 'e2e-fake-sheet';
      document.body.append(s);
    });
    await expect(totop(page)).toBeHidden();
    await page.evaluate(() => document.getElementById('e2e-fake-sheet')?.remove());
    await expect(totop(page)).toBeVisible();
  });

  test('окно игры: своя кнопка для внутренней прокрутки', async ({ page, context, baseURL, isMobile }) => {
    test.skip(!isMobile, 'только мобильный');
    const m = await login(page, context, baseURL!);
    m.trophies[3] = manyTrophies();
    await page.goto('/?game=3&tab=trophies');
    const d = page.getByRole('dialog', { name: 'Horizon Forbidden West' });
    await expect(d.getByText('Трофей 40')).toBeAttached();
    const sc = d.locator('.ps-gd__scroll');
    await sc.evaluate((el) => el.scrollTo(0, el.clientHeight * 1.5));
    const btn = d.getByRole('button', { name: 'Наверх' });
    await expect(btn).toBeVisible();
    // кнопка страницы под окном не дублируется
    await expect(totop(page)).toHaveCount(1);
    await btn.click();
    await expect.poll(() => sc.evaluate((el) => el.scrollTop)).toBe(0);
    await expect(btn).toHaveCount(0);
  });
});

test.describe('заголовок раздела не повторяется на мобильном', () => {
  const hidden = async (page: Page, name: string) => page.getByRole('heading', { name, level: 1 }).evaluate((h) => h.getBoundingClientRect().height);

  test('Статистика: h1 только для скринридеров, «Итоги» остаются', async ({ page, context, baseURL, isMobile }) => {
    await openStats(page, context, baseURL!);
    await expect(page.getByRole('heading', { name: 'Статистика', level: 1 })).toBeAttached();
    await expect(page.getByRole('link', { name: /^Итоги/ }).first()).toBeVisible();
    const h = await hidden(page, 'Статистика');
    if (isMobile) expect(h).toBeLessThanOrEqual(1); else expect(h).toBeGreaterThan(10);
  });

  test('План: подпись «Неделя с понедельника» остаётся', async ({ page, context, baseURL, isMobile }) => {
    await login(page, context, baseURL!);
    await mockRoadmap(page, baseState());
    await page.goto('/roadmap');
    await expect(page.getByText('Неделя с понедельника, время МСК')).toBeVisible();
    const h = await hidden(page, 'План');
    if (isMobile) expect(h).toBeLessThanOrEqual(1); else expect(h).toBeGreaterThan(10);
  });

  test('Подскажи: заголовка под подвкладками нет', async ({ page, context, baseURL, isMobile }) => {
    await login(page, context, baseURL!);
    await page.route(/\/api\/recommend(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { items: [], meta: { llm: 'disabled', candidates: 0, time: 'any' } } }) }));
    await page.route(/\/api\/recommend\/dislikes$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { items: [], ttlDays: 30 } }) }));
    await page.goto('/recommend');
    await expect(page.getByRole('heading', { name: 'Подскажи', level: 1 })).toBeAttached();
    const h = await hidden(page, 'Подскажи');
    if (isMobile) expect(h).toBeLessThanOrEqual(1); else expect(h).toBeGreaterThan(10);
  });
});
