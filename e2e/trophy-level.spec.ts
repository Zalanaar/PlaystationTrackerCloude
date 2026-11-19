// П12.3 «Уровень PSN» на /trophies: уровень, полоса, остаток, прирост и прогноз; без профиля — подсказка той же высоты;
// ответ позже — блок не сдвигает ленту (CLS); 360/390 без горизонтального скролла; axe во всех темах.
import { createRequire } from 'node:module';
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed, type Mock } from './collection-mock';
import { signedSession } from './session';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];
const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const LEVEL = { level: 312, progress: 47, tier: 4, points: 75000, toNext: 477, gained: { d30: { points: 900, levels: 1 }, d365: { points: 12000, levels: 13 } }, eta: { next: `${Number(today().slice(0, 4)) + 1}-01-14`, milestone: { level: 400, date: `${Number(today().slice(0, 4)) + 2}-03-02` } }, approximate: false };

async function open(page: Page, baseURL: string, level: Record<string, unknown> | null, delay = 0): Promise<Mock> {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const m = await mockApi(page, seed());
  if (level) m.level = level;
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
  if (delay) await page.route(/\/api\/trophies\/level(\?|$)/, async (r) => { await new Promise((ok) => setTimeout(ok, delay)); await r.fallback(); });
  await page.route(/\/api\/trophies\/feed(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { period: '7d', rare: false, today: today(), summary: { total: 0, platinum: 0, gold: 0, silver: 0, bronze: 0 }, items: [], nextCursor: null } }) }));
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/trophies');
  return m;
}

test('уровень, полоса, остаток, прирост и прогноз', async ({ page, baseURL }) => {
  await open(page, baseURL!, LEVEL);
  const card = page.getByTestId('tlevel');
  await expect(card.getByTestId('tlevel-num')).toHaveText('312');
  await expect(card.getByTestId('tlevel-next')).toHaveText('47%');
  // F21: две строки — когда следующий уровень и прирост за год
  await expect(card.getByTestId('tlevel-eta')).toHaveText(`До 313: 477 очков, ≈ 14 янв. ${Number(today().slice(0, 4)) + 1}`);
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '47');
  await expect(card.getByTestId('tlevel-meta')).toHaveText(`За год +13 уровней · за 30 дней +1 · 400 ≈ март ${Number(today().slice(0, 4)) + 2}`);
});

test('без профиля — подсказка; ответ позже — без сдвига ленты', async ({ page, baseURL }) => {
  await open(page, baseURL!, null, 1200);
  const sw = page.getByTestId('tf-view');
  await expect(sw).toBeVisible();
  const y0 = (await sw.boundingBox())!.y;
  await expect(page.getByTestId('tlevel')).toHaveText('Уровень PSN появится после синка');
  expect((await sw.boundingBox())!.y).toBe(y0);
  expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.01);
});

for (const w of [360, 390]) {
  test(`${w} px: без горизонтального скролла, axe во всех темах`, async ({ page, baseURL, isMobile }) => {
    test.skip(!isMobile, 'телефон');
    await page.setViewportSize({ width: w, height: 800 });
    await open(page, baseURL!, { ...LEVEL, toNext: 12345, approximate: true });
    await expect(page.getByTestId('tlevel-num')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const card = (await page.getByTestId('tlevel').boundingBox())!;
    for (const id of ['tlevel-next', 'tlevel-eta', 'tlevel-meta']) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(card.y + card.height + 0.5);
    }
    await page.evaluate(axeSource);
    for (const t of THEMES) {
      await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
      await page.waitForTimeout(300);
      const v = await page.evaluate(async () => {
        const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
        const r = await ax.run({ include: [['[data-testid="tlevel"]']] }, { resultTypes: ['violations'] });
        return r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      });
      expect(v, t).toEqual([]);
    }
  });
}
