// F14 (аудит UX): зоны нажатия 44 на «Трофеях», «Плане» и в оценке 0–10 окна игры (видимый размер почти тот же; зону добирает ::after или сетка).
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { baseState, mockRoadmap } from './roadmap-mock';
import { signedSession } from './session';
import { smallHitTargets } from './tap-helpers';

const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function login(page: Page, baseURL: string) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.route('**/api/me/tour', (r) => r.fulfill(json({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } })));
}

test.describe('F14: зоны нажатия 44', () => {
  test.beforeEach(({ isMobile }) => test.skip(!isMobile, 'только мобильный и iPhone'));

  test('/trophies: фильтры периода и «редкие»', async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    await login(page, baseURL!);
    await mockApi(page, seed());
    await page.route(/\/api\/trophies\/feed(\?|$)/, (r) => r.fulfill(json({ ok: true, data: { period: '7d', rare: false, today: today(), summary: { total: 0, platinum: 0, gold: 0, silver: 0, bronze: 0 }, items: [], nextCursor: null } })));
    await page.goto('/trophies');
    await page.getByRole('heading', { level: 1, name: 'Трофеи' }).waitFor();
    await page.waitForTimeout(800);
    expect(await smallHitTargets(page, 'main')).toEqual([]);
  });

  test('/roadmap: флажки, месяцы, чипы', async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await login(page, baseURL!);
    await mockApi(page, []);
    await mockRoadmap(page, baseState());
    await page.goto('/roadmap');
    await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
    await expect(page.locator('.ps-skeleton')).toHaveCount(0, { timeout: 15_000 });
    expect(await smallHitTargets(page, 'main')).toEqual([]);
  });

  test('окно игры: оценка 0–10', async ({ page, baseURL }) => {
    await login(page, baseURL!);
    await mockApi(page, seed());
    await page.goto('/?game=4');
    const rv = page.getByTestId('game-review');
    await rv.scrollIntoViewIfNeeded();
    for (const l of await rv.locator('.ps-rate__opt').all()) {
      const b = (await l.boundingBox())!;
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
    }
  });
});
