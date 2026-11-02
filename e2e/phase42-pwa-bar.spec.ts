// Фаза 42, часть A: смена темы обновляет theme-color и фон верхней области (полоса под статус-баром PWA).
import { test, expect } from '@playwright/test';

const COLORS: Record<string, string> = {
  night: '#0e0f16', graphite: '#111113', ps1: '#1c1c22', ps2: '#070b1a', ps3: '#10070b', ps4: '#02173d', ps5: '#0a0a0c',
};
const BG: Record<string, string> = { ps1: '#cfccc4' }; // html остаётся --bg, меняется только полоса и theme-color
const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };

test('тема -> theme-color, apple-мета и фон верхней полосы', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute('content', 'black-translucent');
  for (const [id, hex] of Object.entries(COLORS)) {
    // как ThemePicker: localStorage + cookie + атрибут, затем перезагрузка (inline-скрипт должен выставить цвет сам)
    await page.evaluate((t) => { localStorage.setItem('ps-theme', t); document.cookie = `ps-theme=${t}; path=/`; }, id);
    await page.reload();
    const metas = page.locator('meta[name="theme-color"]');
    expect(await metas.count()).toBeGreaterThan(0);
    for (const c of await metas.evaluateAll((els) => els.map((e) => e.getAttribute('content')))) expect(c).toBe(hex);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe(rgb(BG[id] ?? hex));
    expect(await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundColor)).toBe(rgb(hex));
  }
});

test('дубли meta с media получают один цвет при смене темы через событие', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() => {
    for (const m of ['(prefers-color-scheme: dark)', '(prefers-color-scheme: light)']) {
      const e = document.createElement('meta'); e.name = 'theme-color'; e.content = '#123456'; e.media = m; document.head.appendChild(e);
    }
    document.documentElement.setAttribute('data-theme', 'ps4');
    window.dispatchEvent(new Event('ps-theme-change'));
  });
  await expect.poll(() => page.locator('meta[name="theme-color"]').evaluateAll((els) => els.map((e) => `${e.getAttribute('content')}|${e.getAttribute('media')}`)))
    .toEqual(Array(await page.locator('meta[name="theme-color"]').count()).fill('#02173d|null'));
});
