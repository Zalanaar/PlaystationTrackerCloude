// QA хвостов 2026-10-31: матрица шага 7 тура (якорь triage-buttons). Кольцо и поповер не пересекаются, либо center без отверстия.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

const stats503 = '{"ok":false,"error":{"code":"db_unavailable","message":"x"}}';
const SIZES = [
  { w: 360, h: 640 }, { w: 768, h: 1024 }, { w: 1440, h: 900 }, { w: 360, h: 520 }, { w: 640, h: 360 }, { w: 320, h: 480 },
];

async function open(page: Page, context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, seed());
  await page.route(/\/api\/stats(\?|$)/, (r) => r.fulfill({ status: 503, contentType: 'application/json', body: stats503 }));
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
  await page.goto('/');
}
const count = (page: Page) => page.getByTestId('tour-count');
const dialog = (page: Page) => page.getByRole('dialog').filter({ has: page.getByTestId('tour-count') });

for (const s of SIZES) {
  test(`шаг 7 при ${s.w}x${s.h}: нет пересечения кольца и поповера, кнопки «Далее» доступны`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: s.w, height: s.h });
    await open(page, context, baseURL!);
    await expect(page.locator('.ps-card').first()).toBeVisible();
    if (s.w < 768) { await page.getByRole('button', { name: 'Меню', exact: true }).click(); await page.getByRole('button', { name: 'Как пользоваться' }).click(); }
    else { await page.locator('.ps-avatar').click(); await page.getByRole('menuitem', { name: 'Как пользоваться' }).click(); }
    await expect(count(page)).toHaveText('1 из 14');
    for (let i = 1; i < 7; i++) await dialog(page).getByRole('button', { name: 'Далее' }).click();
    await expect(count(page)).toHaveText('7 из 14');
    for (const wait of [1500, 1500]) {
      await page.waitForTimeout(wait);
      const mode = await page.locator('.ps-tour').getAttribute('data-mode');
      const g = await page.evaluate(() => {
        const r = (e: Element | null) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        const btn = Array.from(document.querySelectorAll('.ps-tour__pop button')).map((b) => r(b));
        return { spot: r(document.querySelector('.ps-tour__spot')), pop: r(document.querySelector('.ps-tour__pop')), btn, vw: innerWidth, vh: innerHeight };
      });
      expect(g.pop, 'поповер есть').not.toBeNull();
      // поповер целиком в экране
      expect(g.pop!.l).toBeGreaterThanOrEqual(-1); expect(g.pop!.t).toBeGreaterThanOrEqual(-1);
      expect(g.pop!.r).toBeLessThanOrEqual(g.vw + 1); expect(g.pop!.b).toBeLessThanOrEqual(g.vh + 1);
      if (mode === 'spot') {
        const a = g.spot!; const b = g.pop!;
        const hit = a.l < b.r - 1.5 && a.r > b.l + 1.5 && a.t < b.b - 1.5 && a.b > b.t + 1.5;
        expect(hit, `кольцо ${JSON.stringify(a)} пересекает поповер ${JSON.stringify(b)}`).toBe(false);
      } else {
        expect(mode).toBe('center');
        await expect(page.locator('.ps-tour__spot')).toHaveCount(0);
      }
      console.log(`${s.w}x${s.h} mode=${mode}`);
    }
    await expect(dialog(page).getByRole('button', { name: 'Далее' })).toBeInViewport();
  });
}
