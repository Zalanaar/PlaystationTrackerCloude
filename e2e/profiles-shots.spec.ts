// QA Фазы 41: снимки /profiles и переключателя в 7 темах, 1280 и 360 px. Без SHOTS_DIR пропускается.
// Запуск: SHOTS_DIR=docs/qa/shots-41 npx playwright test e2e/profiles-shots.spec.ts --project=desktop
import { test, expect, type Page } from '@playwright/test';
import { setup, THREE } from './profiles-mock';

const SHOTS = process.env.SHOTS_DIR;
const THEMES = ['night', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5', 'graphite'] as const;
const VPS = [{ w: 1280, h: 800 }, { w: 360, h: 740 }, ...(process.env.EXTRA_VP ? [{ w: 320, h: 740 }, { w: 412, h: 800 }] : [])];
test.skip(!SHOTS, 'нужен SHOTS_DIR');
test.beforeEach(({}, i) => { test.skip(i.project.name !== 'desktop'); });
const setTheme = (page: Page, t: string) => page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);

for (const theme of THEMES) for (const vp of VPS) {
  test(`${theme} ${vp.w}`, async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: vp.w, height: vp.h });
    const profiles = THREE();
    profiles[2].accessStatus = 'private';
    await setup(page, baseURL!, profiles, { archived: [{ id: 9, onlineId: 'Old_Nick_Long_Name', archivedAt: '2026-10-20T10:00:00.000Z', purgeAt: new Date(Date.now() + 12 * 86_400_000).toISOString() }] });
    await page.goto('/profiles');
    await expect(page.getByRole('heading', { level: 1, name: 'Профили PSN' })).toBeVisible();
    await setTheme(page, theme);
    await page.waitForTimeout(300);
    const hs = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(hs, 'горизонтальный скролл').toBeLessThanOrEqual(0);
    const edge = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.ps-header *')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => r.right)));
    expect(edge, 'шапка в пределах экрана').toBeLessThanOrEqual(vp.w);
    await page.screenshot({ path: `${SHOTS}/profiles-${theme}-${vp.w}.png`, fullPage: true });
    await page.locator('.ps-pswitch').click();
    await page.getByRole('menuitemradio').first().waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/switcher-${theme}-${vp.w}.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Отвязать профиль Second_Nick' }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('Second');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/unlink-${theme}-${vp.w}.png` });
  });
}
