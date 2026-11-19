// F18: «45 ч 29 м» в плитке «Часы» окна игры на узком телефоне переносится целыми частями, а не обрезается.
import { test, expect } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

for (const w of [360, 390]) {
  test(`${w} px: часы в плитке целиком`, async ({ page, baseURL, isMobile }) => {
    test.skip(!isMobile, 'телефон');
    await page.setViewportSize({ width: w, height: 800 });
    await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    await mockApi(page, seed().map((g) => (g.id === 4 ? { ...g, playSeconds: 45 * 3600 + 29 * 60 } : g)));
    await page.goto('/?game=4');
    const tv = page.locator('.ps-gd__tile[data-tile="hours"] .ps-gd__tv');
    await expect(tv).toContainText('45 ч');
    await expect(tv).toContainText('29 м');
    const fit = await tv.evaluate((el) => [...el.querySelectorAll('.ps-gd__tvp')].every((p) => { const r = p.getBoundingClientRect(); const b = el.getBoundingClientRect(); return r.right <= b.right + 0.5 && r.left >= b.left - 0.5; }) && el.scrollWidth <= el.clientWidth + 1);
    expect(fit).toBe(true);
  });
}
