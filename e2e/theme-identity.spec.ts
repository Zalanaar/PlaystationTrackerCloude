// Айдентика тем (план Designer, утверждён t194u): усиленные мотивы тем без ассетов Sony, мобильный первым,
// анимации только на transform и выключены при prefers-reduced-motion. Шаги: 2 Tiles (ps4), 3 Crystal Towers (ps2),
// 4 Memory Card (ps1), 5 Activity (ps5), 6 Wave (ps3). Night и Dark не меняются.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

async function boot(page: Page, context: BrowserContext, baseURL: string, theme: string) {
  await context.addCookies([
    { name: 'pst_session', value: await signedSession(), url: baseURL },
    { name: 'ps-theme', value: theme, url: baseURL },
  ]);
  await mockApi(page);
  await page.goto('/');
  if (theme === 'night') await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  else await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('.ps-card').first()).toBeVisible();
}
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;
const pseudo = (page: Page, sel: string, pe: '::before' | '::after') =>
  page.evaluate(([s, p]) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = getComputedStyle(el, p);
    return { display: cs.display, content: cs.content, animation: cs.animationName, height: parseFloat(cs.height), opacity: Number(cs.opacity), bg: cs.backgroundImage };
  }, [sel, pe] as const);

/** Сдвиги вёрстки после загрузки (декор не должен двигать контент): окно 800 мс с прокруткой. Chromium; в WebKit layout-shift нет — 0.
 *  Сдвиги самой загрузки данных на dev-сервере с моками не про тему и сюда не входят. */
async function cls(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((res) => {
    if (!PerformanceObserver.supportedEntryTypes?.includes('layout-shift')) return res(0);
    let sum = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) sum += e.value; }).observe({ type: 'layout-shift' });
    scrollTo(0, 400);
    setTimeout(() => { scrollTo(0, 0); setTimeout(() => res(sum), 400); }, 400);
  }));
}

test.describe('Tiles (ps4)', () => {
  test('частицы: на мобильном статичные точки на высоту экрана, подъём только от 768px; reduced-motion без анимации', async ({ page, context, baseURL }) => {
    await boot(page, context, baseURL!, 'ps4');
    const a = await pseudo(page, '.ps-app', '::after');
    expect(a).not.toBeNull();
    expect(a!.display).not.toBe('none');
    expect(a!.bg).toContain('radial-gradient');
    if (isMobile(page)) {
      expect(a!.animation).toBe('none');
      expect(a!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    } else {
      expect(a!.animation).toBe('ps4-dust');
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect((await pseudo(page, '.ps-app', '::after'))!.animation).toBe('none');
    await page.waitForTimeout(1500); // загрузка блоков закончилась (networkidle не наступает: опрос статуса синка)
    expect(await cls(page)).toBe(0);
  });

  test('обводка плиток и разделители кнопок шапки', async ({ page, context, baseURL }) => {
    await boot(page, context, baseURL!, 'ps4');
    const cover = await page.locator('.ps-card__cover').first().evaluate((el) => getComputedStyle(el).boxShadow);
    expect(cover).toContain('rgba(255, 255, 255, 0.32)');
    const seps = await page.locator('.ps-header__right > *').evaluateAll((els) => els.slice(1).filter((e) => getComputedStyle(e).display !== 'none').map((e) => getComputedStyle(e).boxShadow));
    expect(seps.length).toBeGreaterThan(0);
    for (const s of seps) expect(s).toContain('rgba(255, 255, 255, 0.22)');
  });

  test('Night и Dark без новых мотивов: частиц и разделителей нет', async ({ page, context, baseURL }) => {
    for (const t of ['night', 'graphite']) {
      await boot(page, context, baseURL!, t);
      const shadows = await page.locator('.ps-header__right > *').evaluateAll((els) => els.map((e) => getComputedStyle(e).boxShadow));
      for (const s of shadows) expect(s, t).not.toContain('0.22');
    }
  });
});
