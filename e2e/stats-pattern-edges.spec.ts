// П10 (баг с iPhone): «Когда ты играешь» — подсказка выбранного часа и метка пика у крайних часов (00 и 23) не вылезают за карточку.
// Телефон 360 и 390 px, все 7 тем.
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { respond } from './stats-mock';
import { signedSession } from './session';

const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];

async function open(page: Page, baseURL: string, peakHour: number) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  const byHour = Array.from({ length: 24 }, (_, h) => (h === peakHour ? 60 : 5 + (h % 5)));
  await page.route(/\/api\/stats\?/, (r) => {
    const data = respond(new URL(r.request().url())) as Record<string, unknown>;
    data.playPattern = { byHour, byWeekday: [20, 15, 10, 8, 30, 62, 33], total: byHour.reduce((a, b) => a + b, 0), peakHour, peakWeekday: 5, label: 'по времени трофеев', hasData: true };
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  });
  await page.goto('/stats');
  const panel = page.locator('.ps-st-panel', { has: page.getByRole('heading', { name: 'Когда ты играешь' }) });
  await panel.scrollIntoViewIfNeeded();
  return panel;
}

/** Выход элемента за карточку (px, > 0 = вылезает). */
const outside = (page: Page, sel: string) => page.evaluate((s) => {
  const el = document.querySelector(s);
  const card = el?.closest('.ps-st-panel');
  if (!el || !card) return null;
  const a = el.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  return Math.max(c.left - a.left, a.right - c.right);
}, sel);

for (const w of [360, 390]) {
  for (const peak of [23, 0]) {
    test(`${w} px, пик ${peak}: подсказка и метка внутри карточки во всех темах`, async ({ page, baseURL, isMobile }) => {
      test.skip(!isMobile, 'телефон');
      await page.setViewportSize({ width: w, height: 800 });
      const panel = await open(page, baseURL!, peak);
      const bars = panel.getByRole('group', { name: 'Трофеи по часам суток' }).getByRole('img');
      await expect(bars).toHaveCount(24);
      await expect(panel.locator('.ps-pp__pill')).toHaveText(`${String(peak).padStart(2, '0')}:00`);
      for (const t of THEMES) {
        await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
        expect(await outside(page, '.ps-pp__pill'), `${t}: метка пика`).toBeLessThanOrEqual(0);
        for (const i of [0, 23]) {
          await bars.nth(i).click();
          await expect(page.getByRole('tooltip')).toBeVisible();
          expect(await outside(page, '.ps-st-tip--float'), `${t}: подсказка часа ${i}`).toBeLessThanOrEqual(0);
          await bars.nth(i).click(); // повторный тап закрывает
          await expect(page.getByRole('tooltip')).toHaveCount(0);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }
}
