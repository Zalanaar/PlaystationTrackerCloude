// Фаза 42B: лоадер загрузки (четыре знака PlayStation + размытие области контента).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];

async function setup(page: Page, context: BrowserContext, baseURL: string, delay: number) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  // обработчик, добавленный позже, срабатывает первым; fallback передаёт запрос мок-обработчику
  await page.route(/\/api\/games(\/batch)?(\?|$)/, async (r) => { // 48.1: блоки хроники идут batch-ем
    await new Promise((res) => setTimeout(res, delay));
    await r.fallback();
  });
}
const overlay = (page: Page) => page.getByTestId('loader-overlay');
const setTheme = (page: Page, t: string) => page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('лоадер загрузки', () => {
  // Детерминированно: MutationObserver (addInitScript) фиксирует, показывался ли оверлей и когда появились карточки.
  // Правило «быстрее 200 мс -> без оверлея» проверяет gate.test.ts; здесь утверждаем только непротиворечивость:
  // оверлей никогда не появляется раньше задержки 200 мс от старта страницы.
  test('быстрая загрузка: оверлей не мигает, если данные пришли быстрее задержки', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!, 0);
    await page.addInitScript(() => {
      const w = window as unknown as { __ov: number | null; __cards: number | null; __t0: number };
      w.__ov = null; w.__cards = null; w.__t0 = performance.now();
      new MutationObserver(() => {
        const n = performance.now() - w.__t0;
        if (w.__ov === null && document.querySelector('[data-testid="loader-overlay"]')) w.__ov = n;
        if (w.__cards === null && document.querySelector('.ps-card')) w.__cards = n;
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto('/');
    await expect(page.locator('.ps-card').first()).toBeVisible();
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => { const w = window as unknown as { __ov: number | null; __cards: number | null }; return { ov: w.__ov, cards: w.__cards }; });
    expect(r.cards).not.toBeNull();
    if (r.ov === null) return; // оверлея не было: верно при любой скорости
    // оверлей был (медленный dev-сервер, повторная загрузка после первой отрисовки): раньше задержки 200 мс он появиться не мог
    expect(r.ov).toBeGreaterThanOrEqual(190);
  });

  test('долгая загрузка: оверлей появляется, исчезает, шапка не затронута', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!, 1500);
    await page.goto('/');
    await expect(overlay(page)).toBeVisible({ timeout: 1200 });
    await expect(overlay(page)).toHaveAttribute('role', 'status');
    await expect(overlay(page)).toContainText('Загрузка');
    await expect(overlay(page).locator('svg')).toHaveCount(4);
    // оверлей начинается под шапкой; шапка и навигация принимают клики
    const geo = await page.evaluate(() => {
      const o = document.querySelector('[data-testid="loader-overlay"]')!.getBoundingClientRect();
      const h = document.querySelector('.ps-header')!.getBoundingClientRect();
      const hit = document.elementFromPoint(h.left + 40, h.top + h.height / 2);
      return { oTop: o.top, hBottom: h.bottom, headerHit: !!hit?.closest('.ps-header'), root: document.querySelector('.ps-collection')!.hasAttribute('inert') };
    });
    expect(geo.oTop).toBeGreaterThanOrEqual(geo.hBottom - 1);
    expect(geo.headerHit).toBe(true);
    expect(geo.root).toBe(true);
    const bf = await page.evaluate(() => getComputedStyle(document.querySelector('.ps-header')!).backdropFilter);
    expect(bf).not.toContain('blur(6px)');
    await expect(overlay(page)).toHaveCount(0, { timeout: 5000 });
    expect(await page.locator('.ps-collection').getAttribute('inert')).toBeNull();
  });

  test('навигация доступна во время загрузки', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!, 2500);
    await page.goto('/');
    await expect(overlay(page)).toBeVisible({ timeout: 1200 });
    const link = page.locator('.ps-nav-item, .ps-tab').filter({ hasText: 'Статистика' }).locator('visible=true').first();
    await link.click();
    await expect(page).toHaveURL(/\/stats/);
  });

  test('7 тем: знаки окрашены токенами, без горизонтального скролла', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!, 4000);
    await page.goto('/');
    await expect(overlay(page)).toBeVisible({ timeout: 1200 });
    for (const t of THEMES) {
      await setTheme(page, t);
      const colors = await overlay(page).locator('svg').evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
      expect(new Set(colors).size).toBe(4);
      for (const c of colors) expect(c).not.toBe('rgba(0, 0, 0, 0)');
      expect(await noHScroll(page)).toBe(true);
    }
  });

  test('reduced-motion: без анимации знаков', async ({ page, context, baseURL }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setup(page, context, baseURL!, 2500);
    await page.goto('/');
    await expect(overlay(page)).toBeVisible({ timeout: 1200 });
    const names = await overlay(page).locator('svg').evaluateAll((els) => els.map((e) => getComputedStyle(e).animationName));
    expect(names.every((n) => n === 'none')).toBe(true);
  });

  for (const w of [320, 412]) {
    test(`ширина ${w}: без сдвига и скролла, нижняя навигация открыта`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await setup(page, context, baseURL!, 2500);
      await page.goto('/');
      await expect(overlay(page)).toBeVisible({ timeout: 1200 });
      // оверлей вне потока: не двигает вёрстку
      expect(await overlay(page).evaluate((e) => getComputedStyle(e).position)).toBe('fixed');
      expect(await noHScroll(page)).toBe(true);
      const r = await page.evaluate(() => {
        const o = document.querySelector('[data-testid="loader-overlay"]')!.getBoundingClientRect();
        const t = document.querySelector('.ps-tabbar')?.getBoundingClientRect();
        return { oBottom: o.bottom, tTop: t ? t.top : null };
      });
      if (r.tTop !== null) expect(r.oBottom).toBeLessThanOrEqual(r.tTop + 1);
    });
  }

  test('Бэклог: оверлей на медленном запросе', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!, 1500);
    await page.goto('/backlog');
    await expect(overlay(page)).toBeVisible({ timeout: 1200 });
    await expect(overlay(page)).toHaveCount(0, { timeout: 5000 });
  });
});
