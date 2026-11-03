// QA Фазы 21: снимки тура в темах Night, PS1, PS5 на 360 / 768 / 1440 + проверка геометрии (кольцо не перекрыто, поповер в экране).
// Без SHOTS_DIR пропускается. Запуск на своём порту: см. docs/qa/phase-21.md.
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

const SHOTS = process.env.SHOTS_DIR;
const THEMES = ['night', 'ps1', 'ps5'] as const;
const VPS = [{ w: 360, h: 640 }, { w: 768, h: 1024 }, { w: 1440, h: 900 }];
const STEPS = [1, 2, 3, 5, 7, 8, 9, 10, 12, 14];
const WHITE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const setTheme = (page: Page, t: string) =>
  page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);

test.skip(!SHOTS, 'нужен SHOTS_DIR');

for (const theme of THEMES)
  for (const vp of VPS)
    test(`тур ${theme} ${vp.w}`, async ({ page, context, baseURL }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
      await mockApi(page, seed().map((g) => ({ ...g, coverUrl: 'https://img.example/white.png' })));
      await page.route('https://img.example/white.png', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(WHITE, 'base64') }));
      await page.route(/\/api\/stats(\?|$)/, (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":{"code":"db_unavailable","message":"x"}}' }));
      await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
      await page.goto('/');
      await expect(page.locator('.ps-card').first()).toBeVisible();
      await setTheme(page, theme);
      const mobile = vp.w < 768;
      if (mobile) { await page.getByRole('button', { name: 'Меню', exact: true }).click(); await page.getByRole('button', { name: 'Как пользоваться' }).click(); }
      else { await page.locator('.ps-avatar').click(); await page.getByRole('menuitem', { name: 'Как пользоваться' }).click(); }
      const problems: string[] = [];
      for (let i = 1; i <= 14; i++) {
        await expect(page.getByTestId('tour-count')).toHaveText(`${i} из 14`);
        await expect(page.locator('.ps-tour')).not.toHaveAttribute('data-mode', 'loading', { timeout: 10_000 });
        await expect(page.locator('[data-tour-page][data-tour-ready="true"]')).toHaveCount(1, { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(500);
        // ждём, пока прожектор перестанет двигаться (перелёт, прокрутка)
        let prev = '';
        await expect.poll(async () => {
          const cur = await page.evaluate(() => { const b = document.querySelector('.ps-tour__spot')?.getBoundingClientRect(); const p = document.querySelector('.ps-tour__pop')!.getBoundingClientRect(); return b ? `${b.left}|${b.top}|${b.width}|${b.height}|${p.left}|${p.top}` : `none|${p.left}|${p.top}`; });
          const ok = cur === prev; prev = cur; return ok;
        }, { timeout: 6000, intervals: [300] }).toBe(true);
        const g = await page.evaluate(() => {
          const r = (e: Element | null) => (e ? e.getBoundingClientRect() : null);
          const s = r(document.querySelector('.ps-tour__spot')), p = r(document.querySelector('.ps-tour__pop'))!;
          const sc = document.querySelector('.ps-tour__body');
          return {
            spot: s && { x: s.left, y: s.top, w: s.width, h: s.height }, pop: { x: p.left, y: p.top, w: p.width, h: p.height },
            clipped: !!sc && sc.scrollHeight > sc.clientHeight + 1, vw: innerWidth, vh: innerHeight, hscroll: document.documentElement.scrollWidth > innerWidth,
          };
        });
        const tag = `${theme}/${vp.w}/шаг ${i}`;
        if (g.pop.x < -0.5 || g.pop.y < -0.5 || g.pop.x + g.pop.w > g.vw + 0.5 || g.pop.y + g.pop.h > g.vh + 0.5) problems.push(`${tag}: поповер вне экрана`);
        if (g.clipped) problems.push(`${tag}: текст поповера прокручивается (обрезан)`);
        if (g.hscroll) problems.push(`${tag}: горизонтальная прокрутка`);
        if (g.spot) {
          const e = 1.5;
          if (g.pop.x < g.spot.x + g.spot.w - e && g.pop.x + g.pop.w > g.spot.x + e && g.pop.y < g.spot.y + g.spot.h - e && g.pop.y + g.pop.h > g.spot.y + e) problems.push(`${tag}: поповер перекрывает кольцо`);
        }
        if (STEPS.includes(i)) await page.screenshot({ path: `${SHOTS}/${theme}-${vp.w}-s${String(i).padStart(2, '0')}.png` });
        if (i < 14) await page.getByRole('dialog').filter({ has: page.getByTestId('tour-count') }).getByRole('button', { name: 'Далее' }).click();
      }
      console.log(`PROBLEMS ${theme}/${vp.w}: ${problems.length ? '\n' + problems.join('\n') : 'нет'}`);
    });
