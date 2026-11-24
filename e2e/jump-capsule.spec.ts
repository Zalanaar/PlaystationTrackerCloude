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
const backlog = (): G[] => [
  ...Array.from({ length: 24 }, (_, i): G => ({
    id: 700 + i, title: `Бэклог ${i + 1}`, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 600, playCount: 1, trophies: null,
  })),
  ...Array.from({ length: 3 }, (_, i): G => ({
    id: 800 + i, title: `Сервис ${i + 1}`, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'service', completedAt: null, droppedAt: null, playSeconds: 600, playCount: 1, trophies: null,
  })),
];

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


/** Активный чип целиком внутри скруглённой капсулы (не вылезает за край пилюли). */
async function assertChipInside(row: Locator, chip: Locator) {
  await expect(chip).toBeVisible();
  const info = await chip.evaluate((el) => {
    const cap = el.closest('.ps-jumpcap');
    if (!cap) return { error: 'no capsule' };
    const cr = cap.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const radius = cr.height / 2;
    const midY = (r.top + r.bottom) / 2;
    const midX = (r.left + r.right) / 2;
    const k = 1 - Math.SQRT1_2;
    const hr = r.height / 2;
    const points = [
      [r.left, midY],
      [r.right, midY],
      [midX, r.top],
      [midX, r.bottom],
      [r.left + hr * k, r.top + hr * k],
      [r.right - hr * k, r.top + hr * k],
      [r.left + hr * k, r.bottom - hr * k],
      [r.right - hr * k, r.bottom - hr * k],
    ];
    const inside = (x: number, y: number) => {
      const x0 = cr.left + radius;
      const x1 = cr.right - radius;
      const cy = (cr.top + cr.bottom) / 2;
      if (x >= x0 && x <= x1) return y >= cr.top - 0.5 && y <= cr.bottom + 0.5;
      const cx = x < x0 ? x0 : x1;
      return (x - cx) ** 2 + (y - cy) ** 2 <= (radius + 0.75) ** 2;
    };
    const outside = points.filter(([x, y]) => !inside(x, y)).map(([x, y]) => ({ x, y }));
    return {
      padL: r.left - cr.left,
      padR: cr.right - r.right,
      padT: r.top - cr.top,
      padB: cr.bottom - r.bottom,
      outside,
    };
  });
  expect(info, JSON.stringify(info)).not.toHaveProperty('error');
  expect(info.padL, JSON.stringify(info)).toBeGreaterThanOrEqual(3);
  expect(info.padR, JSON.stringify(info)).toBeGreaterThanOrEqual(3);
  expect(info.padT, JSON.stringify(info)).toBeGreaterThanOrEqual(3);
  expect(info.padB, JSON.stringify(info)).toBeGreaterThanOrEqual(3);
  expect(info.outside, JSON.stringify(info)).toEqual([]);
}

async function assertEndsInside(row: Locator) {
  const chips = row.locator('button, a[href^="#"]');
  const n = await chips.count();
  expect(n).toBeGreaterThanOrEqual(2);
  const inner = row.locator('.ps-jumpcap__in');
  await chips.first().click();
  await inner.evaluate((el) => { el.scrollLeft = 0; });
  await assertChipInside(row, chips.first());
  await chips.last().click();
  await inner.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await assertChipInside(row, chips.last());
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

  test('первый и последний чип не вылезают из пилюли — все темы, 390px', async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, context, baseURL as string, chronicle());
    await page.goto('/');
    const months = page.getByRole('navigation', { name: 'Месяцы 2026' });
    await expect(months.getByRole('button').first()).toBeVisible();
    for (const theme of ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5']) {
      await page.evaluate((v) => {
        if (v === 'night') document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', v);
      }, theme);
      await assertEndsInside(months);
    }

    await mockRoadmap(page, baseState());
    await page.goto('/roadmap');
    await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
    await assertEndsInside(page.getByTestId('rm-jump'));

    await openStats(page, context, baseURL!);
    await expect(page.getByTestId('stats-sections').getByRole('button', { name: 'Часы' })).toBeVisible();
    await assertEndsInside(page.getByTestId('stats-sections'));

    await login(page, context, baseURL as string, backlog());
    await page.goto('/backlog');
    await expect(page.getByTestId('bl-jump').getByRole('button').first()).toBeVisible();
    await assertEndsInside(page.getByTestId('bl-jump'));
  });
});
