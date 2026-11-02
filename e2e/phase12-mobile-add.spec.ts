// Регресс: на мобильном в «Предстоящих релизах» кнопка «В план» видна, в пределах экрана и работает.
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { baseState, mockRoadmap, upc } from './roadmap-mock';
import { signedSession } from './session';
import { THEMES, THEME_STORAGE_KEY } from '../src/ui/tokens';

async function open(page: Page, baseURL: string, theme?: string) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  if (theme) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [THEME_STORAGE_KEY, theme]);
  await mockApi(page, []);
  await mockRoadmap(page, baseState({ upcoming: { pages: [[upc(1, { title: 'Новинка 1', releaseDate: '2026-11-19' }), ...Array.from({ length: 11 }, (_, i) => upc(i + 2))]], fail: null } }));
  await page.goto('/roadmap');
  await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
}

async function check(page: Page) {
  const row = page.getByTestId('rm-upcoming-row').first();
  const btn = row.getByRole('button', { name: 'В план: Новинка 1' });
  await btn.scrollIntoViewIfNeeded();
  await expect(btn).toBeVisible();
  const vp = page.viewportSize()!;
  const b = (await btn.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
  expect(b.height).toBeGreaterThanOrEqual(40);
  const rb = (await row.boundingBox())!;
  expect(b.y + b.height).toBeLessThanOrEqual(rb.y + rb.height + 1);
  const hit = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return !!el?.closest('button[aria-label^="В план"]');
  }, [b.x + b.width / 2, b.y + b.height / 2]);
  expect(hit).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await btn.click();
  await expect(row).toContainText('В плане');
}

test.describe('Предстоящие релизы на мобильном', () => {
  for (const w of [320, 390, 412]) {
    test(`«В план» видна и работает, ${w}px`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width: w, height: 844 });
      await open(page, baseURL as string);
      await check(page);
    });
  }
  for (const t of THEMES) {
    test(`тема ${t.id}: кнопка «В план» на 390px`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, baseURL as string, t.id);
      await check(page);
    });
  }
});
