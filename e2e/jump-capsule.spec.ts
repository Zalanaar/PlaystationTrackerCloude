// Единая плавающая капсула быстрого перехода (Коллекция, План, Статистика, Бэклог) — блюр, зазор, активный чип.
import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { mockApi, seed, type G } from './collection-mock';
import { signedSession } from './session';
import { open as openStats } from './stats-mock';
import { baseState, mockRoadmap } from './roadmap-mock';

const done = (id: number, month: number, day: number): G => ({
  id, title: `Пройдена ${id}`, lastPlayedAt: new Date(Date.UTC(2026, month, day, 10)).toISOString(), status: 'completed',
  completedAt: new Date(Date.UTC(2026, month, day, 10)).toISOString(), droppedAt: null, playSeconds: 3600 * 5, playCount: 3, trophies: null,
});
const chronicle = (): G[] => [...seed(), ...Array.from({ length: 36 }, (_, i) => done(500 + i, 9 - Math.floor(i / 6), 20 - (i % 6)))];
const backlog = (): G[] => Array.from({ length: 24 }, (_, i): G => ({
  id: 700 + i, title: `Бэклог ${i + 1}`, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 600, playCount: 1, trophies: null,
}));

async function login(page: Page, context: BrowserContext, baseURL: string, games: G[]) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  return mockApi(page, games);
}

async function assertCapsule(row: Locator) {
  await expect(row).toBeVisible();
  const st = await row.evaluate((el) => {
    const c = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const f = c.backdropFilter || (c as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter || 'none';
    return {
      f, radius: c.borderRadius,
      left: r.left, right: innerWidth - r.right,
      width: r.width, vw: innerWidth,
      clip: c.clipPath,
    };
  });
  expect(st.f).toMatch(/blur\(/);
  const rad = Math.max(...(st.radius.match(/[\d.]+/g) ?? ['0']).map(Number));
  expect(rad).toBeGreaterThanOrEqual(20);
  expect(st.left).toBeGreaterThanOrEqual(4);
  expect(st.right).toBeGreaterThanOrEqual(4);
  expect(st.width).toBeLessThan(st.vw - 6);
  expect(st.clip === 'none' || st.clip === '').toBe(true);
  const active = row.locator('[aria-current="true"], [aria-current="location"]');
  await expect(active.first()).toBeVisible();
  const bg = await active.first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toMatch(/rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)/);
  expect(bg).not.toBe('transparent');
}

test.describe('плавающая капсула быстрого перехода', () => {
  for (const width of [390, 1280]) {
    test(`${width}px: Коллекция, План, Статистика, Бэклог — одна капсула с блюром`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width, height: 800 });

      await login(page, context, baseURL as string, chronicle());
      await page.goto('/');
      const months = page.getByRole('navigation', { name: 'Месяцы 2026' });
      await expect(months.getByRole('button').first()).toBeVisible();
      await page.evaluate(() => window.scrollBy(0, 400));
      await assertCapsule(months);

      await mockRoadmap(page, baseState());
      await page.goto('/roadmap');
      await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
      const plan = page.getByTestId('rm-jump');
      await expect(plan).toBeVisible();
      await page.evaluate(() => window.scrollBy(0, 200));
      await assertCapsule(plan);

      await openStats(page, context, baseURL!);
      const stats = page.getByTestId('stats-sections');
      await expect(stats.getByRole('button', { name: 'Часы' })).toBeVisible();
      await page.evaluate(() => window.scrollBy(0, 200));
      await assertCapsule(stats);

      await login(page, context, baseURL as string, backlog());
      await page.goto('/backlog');
      const bl = page.getByTestId('bl-jump');
      await expect(bl.getByRole('button').first()).toBeVisible();
      await page.evaluate(() => window.scrollBy(0, 400));
      await assertCapsule(bl);
    });
  }

  test('капсула месяцев читается во всех темах', async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await login(page, context, baseURL as string, chronicle());
    await page.goto('/');
    const months = page.getByRole('navigation', { name: 'Месяцы 2026' });
    await expect(months.getByRole('button').first()).toBeVisible();
    for (const theme of ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5']) {
      await page.evaluate((v) => {
        if (v === 'night') document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', v);
      }, theme);
      await assertCapsule(months);
    }
  });
});
