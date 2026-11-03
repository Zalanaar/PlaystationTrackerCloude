// Фаза 39 (QA): 7 тем на 360 px: карточка iOS «Установить», /offline, шапка. Скриншоты в test-results/shots/shots-39 (или SHOTS_DIR).
import { expect, test } from '@playwright/test';
import { signedSession } from './session';
import { shotsDir } from './shots';

const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'] as const;
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ORIGIN = `http://localhost:${process.env.PWA_PORT ?? 3231}`;
const SHOTS = shotsDir('shots-39');

function lum(rgb: string) {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map((v) => { const c = Number(v) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test.describe('7 тем, 360 px', () => {
  test.use({ viewport: { width: 360, height: 740 }, userAgent: IOS_UA, hasTouch: true, isMobile: true });
  for (const theme of THEMES) {
    test(`карточка iOS и /offline: ${theme}`, async ({ page, context }, info) => {
      test.skip(info.project.name !== 'desktop', 'один проход достаточен: вьюпорт и UA заданы явно');
      await context.addCookies([
        { name: 'pst_session', value: await signedSession(), url: ORIGIN },
        { name: 'ps-theme', value: theme, url: ORIGIN },
      ]);
      await page.addInitScript(() => localStorage.setItem('ps.install.visits', '2'));
      await page.goto('/stats');
      const card = page.getByTestId('install-prompt');
      await expect(card).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOTS}/install-ios-${theme}.png` });
      const box = (await card.boundingBox())!;
      expect(Math.round(box.width)).toBeLessThanOrEqual(328 + 1);
      const tab = (await page.locator('.ps-tabbar').boundingBox())!;
      expect(box.y + box.height, 'карточка не перекрывает tab bar').toBeLessThanOrEqual(tab.y);
      // контраст заголовка, текста и «Понятно» против фона карточки
      const c = await page.evaluate(() => {
        const q = (s: string) => getComputedStyle(document.querySelector(s)!).color;
        return { bg: getComputedStyle(document.querySelector('.ps-install')!).backgroundColor, title: q('.ps-install__title'), text: q('.ps-install__text'), step: q('.ps-install__steps li span:last-child'), btn: q('.ps-install__btn') };
      });
      for (const k of ['title', 'text', 'step', 'btn'] as const) expect(ratio(c[k], c.bg), `${theme}.${k} ${c[k]} на ${c.bg}`).toBeGreaterThanOrEqual(4.5);
      // нет горизонтального скролла
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // стрелка: геометрия и цвет = фону карточки
      const arrow = await page.evaluate(() => { const a = document.querySelector('.ps-install__arrow')!; const s = getComputedStyle(a); return { bg: s.backgroundColor, w: s.width, h: s.height }; });
      expect(arrow.bg).toBe(c.bg);
      // /offline той же темой (без сети: из кэша не нужно, достаточно живого вида)
      await page.goto('/offline');
      await expect(page.getByRole('heading', { name: 'Нет сети' })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/offline-${theme}.png` });
      const off = await page.evaluate(() => ({ h1: getComputedStyle(document.querySelector('h1')!).color, p: getComputedStyle(document.querySelector('.ps-offline__text')!).color, bg: getComputedStyle(document.body).backgroundColor, sw: document.documentElement.scrollWidth <= window.innerWidth }));
      expect(off.sw).toBe(true);
      expect(ratio(off.p, off.bg), `${theme} offline text`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

test.describe('safe-area не ломает десктоп', () => {
  test('шапка 56 px на десктопе без inset, горизонтальных сдвигов нет', async ({ page, context }, info) => {
    test.skip(info.project.name !== 'desktop');
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: ORIGIN }]);
    await page.goto('/stats');
    const m = await page.evaluate(() => {
      const h = document.querySelector('.ps-header')!;
      const s = getComputedStyle(h);
      return { h: h.getBoundingClientRect().height, pt: s.paddingTop, sw: document.documentElement.scrollWidth <= window.innerWidth, inset: getComputedStyle(document.querySelector('.ps-container')!).paddingLeft };
    });
    expect(m.h).toBe(56 + 1); // 56 + border-bottom 1px
    expect(m.pt).toBe('0px');
    expect(m.sw).toBe(true);
  });
});
