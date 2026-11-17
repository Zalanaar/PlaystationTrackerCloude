// П13.1: «Достижения» в «Всё время» Статистики — 12 плиток, «Получено N из 12», дата и подпись у полученных, «7 из 10» и полоса у остальных;
// чип раздела «Достижения»; сбой — панели нет; 360 px без скролла, скелет той же высоты, axe во всех темах. API эмулируется.
import { createRequire } from 'node:module';
import { test, expect, type Page } from '@playwright/test';
import { emptyAchievements, mockApi } from './collection-mock';
import { signedSession } from './session';
import { statsAll } from './stats-all-fixture';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];

function filled() {
  const a = emptyAchievements();
  const set = (id: string, o: Record<string, unknown>) => { const x = a.items.find((i) => i.id === id)!; Object.assign(x, o); };
  set('completed_1', { value: 7, unlocked: true, at: '2025-03-18T10:00:00.000Z' });
  set('completed_10', { value: 7 });
  set('completed_50', { value: 7 });
  set('marathon', { value: 120, unlocked: true, detail: 'Elden Ring' });
  set('hours_100', { value: 450, unlocked: true });
  set('hours_1000', { value: 450 });
  a.unlocked = 3;
  return a;
}

async function go(page: Page, baseURL: string, body: Record<string, unknown> | null, gate?: Promise<void>) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const m = await mockApi(page);
  m.achievements = body;
  if (gate) {
    await page.route(/\/api\/stats\/achievements(\?|$)/, async (r) => { await gate; await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: body }) }); });
  }
  await page.route(/\/api\/stats\?/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: statsAll({}) }) }));
  await page.goto('/stats?period=all');
}

test('плитки, сводка, состояния', async ({ page, baseURL }) => {
  await go(page, baseURL!, filled());
  const panel = page.locator('.ps-ach');
  await expect(panel.getByRole('heading', { name: 'Достижения' })).toBeVisible();
  await expect(panel.getByText('Получено 3 из 12')).toBeVisible();
  await expect(panel.getByTestId('ach-item')).toHaveCount(12);
  const item = (id: string) => panel.locator(`[data-ach="${id}"]`);
  await expect(item('completed_1')).toHaveAttribute('data-unlocked', 'true');
  await expect(item('completed_1')).toContainText('Первая пройденная');
  await expect(item('completed_1')).toContainText('Получено 18.03.2025');
  await expect(item('marathon')).toContainText('Получено · Elden Ring');
  await expect(item('completed_10')).toContainText('7 из 10');
  await expect(item('completed_10').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '70');
  await expect(item('hours_1000')).toContainText(/450 из 1.000 ч/);
  await expect(item('completed_1').getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByTestId('stats-sections').locator('[data-sec="ach"]')).toHaveText('Достижения');
});

test('сбой запроса — панели нет', async ({ page, baseURL }) => {
  await go(page, baseURL!, null);
  await expect(page.getByRole('heading', { name: /Трофеи/ }).first()).toBeVisible();
  await expect(page.locator('.ps-ach')).toHaveCount(0);
});

for (const w of [360, 390]) {
  test(`${w} px: без горизонтального скролла, высота плиток, axe во всех темах`, async ({ page, baseURL, isMobile }) => {
    test.skip(!isMobile, 'телефон');
    await page.setViewportSize({ width: w, height: 800 });
    await go(page, baseURL!, filled());
    await expect(page.getByTestId('ach-item')).toHaveCount(12);
    await page.locator('.ps-ach').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const hs = await page.getByTestId('ach-item').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(new Set(hs).size).toBe(1);
    await page.evaluate(axeSource);
    for (const t of THEMES) {
      await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
      await page.waitForTimeout(300);
      const v = await page.evaluate(async () => {
        const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
        const r = await ax.run({ include: [['.ps-ach']] }, { resultTypes: ['violations'] });
        return r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      });
      expect(v, t).toEqual([]);
    }
  });
}

test('без сдвига: скелет и данные одной высоты', async ({ page, baseURL, isMobile }) => {
  test.skip(!isMobile, 'телефон');
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  await go(page, baseURL!, filled(), gate);
  const panel = page.locator('.ps-ach');
  await expect(panel).toHaveAttribute('aria-busy', 'true');
  const before = (await panel.boundingBox())!.height;
  release();
  await expect(page.getByTestId('ach-item')).toHaveCount(12);
  expect(Math.abs((await panel.boundingBox())!.height - before)).toBeLessThanOrEqual(1);
});
