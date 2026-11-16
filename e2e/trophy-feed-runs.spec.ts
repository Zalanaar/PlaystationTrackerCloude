// П12.2: в ленте трофеев серия одной игры за день (3+ подряд) свёрнута в строку «Игра · +N»; тап раскрывает трофеи, строки внутри
// ведут в окно игры; платина всегда отдельной строкой; телефон 360 без горизонтального скролла; axe во всех темах.
import { createRequire } from 'node:module';
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];

async function open(page: Page, baseURL: string) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, seed());
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const now = Date.now();
  let id = 100;
  const mk = (setId: number, type: string, rate: number, gameId: number | null, title: string) => {
    id -= 1;
    return { id, setId, trophyId: id, type, name: `Трофей ${id}`, detail: null, iconUrl: null, earnedAt: new Date(now - (100 - id) * 60_000).toISOString(), day: today, earnedRate: rate, rarity: 2, setName: title, game: gameId === null ? null : { id: gameId, title } };
  };
  const items = [
    mk(1, 'platinum', 3.1, 3, 'Horizon Forbidden West'),
    mk(1, 'gold', 6.5, 3, 'Horizon Forbidden West'), mk(1, 'bronze', 40, 3, 'Horizon Forbidden West'), mk(1, 'bronze', 2.4, 3, 'Horizon Forbidden West'), mk(1, 'bronze', 50, 3, 'Horizon Forbidden West'), mk(1, 'silver', 30, 3, 'Horizon Forbidden West'),
    mk(2, 'bronze', 60, 4, 'Stray'), mk(2, 'bronze', 61, 4, 'Stray'),
    mk(3, 'bronze', 70, null, 'Очень длинное название набора трофеев, которого нет в коллекции'), mk(3, 'bronze', 71, null, 'Очень длинное название набора трофеев, которого нет в коллекции'), mk(3, 'silver', 72, null, 'Очень длинное название набора трофеев, которого нет в коллекции'),
  ];
  const summary = { total: items.length, platinum: 1, gold: 1, silver: 2, bronze: 7 };
  await page.route(/\/api\/trophies\/feed(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { period: '7d', rare: false, today, summary, items, nextCursor: null } }) }));
  await page.goto('/trophies');
  await expect(page.getByTestId('tfeed-run').first()).toBeVisible();
}

test('серии свёрнуты, платина и короткие серии строками; тап раскрывает, Enter сворачивает; строка внутри — окно игры', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  const runs = page.getByTestId('tfeed-run');
  await expect(runs).toHaveCount(2);
  await expect(page.locator('.ps-tf__rows > li[data-testid="tfeed-row"]')).toHaveCount(3); // платина + 2 Stray
  const hfw = runs.nth(0).locator('.ps-tf__runbtn');
  await expect(hfw).toContainText('Horizon Forbidden West');
  await expect(hfw).toContainText('5 трофеев · 1 золото · 1 серебро · 3 бронзы');
  await expect(hfw).toContainText('2,4%'); // самый редкий в серии
  await expect(hfw).toHaveAttribute('aria-expanded', 'false');
  await hfw.click();
  await expect(hfw).toHaveAttribute('aria-expanded', 'true');
  const inner = runs.nth(0).getByTestId('tfeed-row');
  await expect(inner).toHaveCount(5);
  await hfw.focus();
  await page.keyboard.press('Enter');
  await expect(inner).toHaveCount(0);
  await hfw.click();
  await inner.first().locator('a').click();
  await expect(page).toHaveURL(/[?&]game=3(&|$)/);
});

for (const w of [360, 390]) {
  test(`${w} px: без горизонтального скролла, зона нажатия, axe во всех темах`, async ({ page, baseURL, isMobile }) => {
    test.skip(!isMobile, 'телефон');
    await page.setViewportSize({ width: w, height: 800 });
    await open(page, baseURL!);
    const runs = page.getByTestId('tfeed-run');
    await runs.nth(1).locator('.ps-tf__runbtn').click();
    await expect(runs.nth(1).getByTestId('tfeed-row')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    for (const b of await page.locator('.ps-tf__runbtn').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.evaluate(axeSource);
    for (const t of THEMES) {
      await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
      await page.waitForTimeout(300);
      const v = await page.evaluate(async () => {
        const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
        const r = await ax.run({ include: [['.ps-tf__list']] }, { resultTypes: ['violations'] });
        return r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      });
      expect(v, t).toEqual([]);
    }
  });
}
