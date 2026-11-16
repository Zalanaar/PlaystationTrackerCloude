// П9 «Удобство»: подпись месяца («Ноябрь 2026», «Сентябрь 2025») в переключателе Статистики в одну строку рядом с кнопкой «Итоги».
// Телефон 360 и 390 px, все 7 тем (у тем свои шрифты заголовков).
import { test, expect } from '@playwright/test';
import { open } from './stats-mock';

for (const w of [360, 390]) {
  test(`месяц в одну строку при ${w} px`, async ({ page, context, baseURL, isMobile }) => {
    test.skip(!isMobile, 'телефон');
    await page.setViewportSize({ width: w, height: 800 });
    await open(page, context, baseURL!, '/stats?period=month&year=2025&month=9');
    const label = page.locator('.ps-st-nav__label');
    await expect(label).toHaveText('Сентябрь 2025');
    const btn = page.locator('.ps-st-wrapped-btn--switch');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAccessibleName(/Итоги\s*2025/); // год виден скринридеру, даже если скрыт визуально
    for (const t of ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5']) {
      const m = await page.evaluate((v) => {
        if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v);
        const el = document.querySelector<HTMLElement>('.ps-st-nav__label')!;
        const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.3;
        const b = document.querySelector<HTMLElement>('.ps-st-wrapped-btn--switch')!.getBoundingClientRect();
        const n = document.querySelector<HTMLElement>('.ps-st-nav')!.getBoundingClientRect();
        return { lines: Math.round(el.getBoundingClientRect().height / lh), cut: el.scrollWidth > el.clientWidth + 1, overlap: n.right > b.left + 1, sameRow: Math.abs(n.top + n.height / 2 - (b.top + b.height / 2)) < 4 };
      }, t);
      expect({ t, ...m }).toEqual({ t, lines: 1, cut: false, overlap: false, sameRow: true });
    }
  });
}
