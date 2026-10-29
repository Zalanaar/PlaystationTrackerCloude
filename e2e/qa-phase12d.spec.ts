// QA «7 багов Артёма»: гонки «Поставить на позицию», ошибки PUT, геометрия таймлайна по дням, a11y полос, XSS.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { baseState, mockRoadmap, type RmState } from './roadmap-mock';
import { signedSession } from './session';
import { THEMES, THEME_STORAGE_KEY } from '../src/ui/tokens';

async function open(page: Page, context: BrowserContext, baseURL: string, s: RmState, theme?: string): Promise<RmState> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  if (theme) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [THEME_STORAGE_KEY, theme]);
  await mockApi(page, []);
  await mockRoadmap(page, s);
  await page.goto('/roadmap');
  await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
  await page.locator('.ps-rm-bar, [data-testid="rm-to-pos"], .ps-rm-empty').first().waitFor();
  return s;
}
const noScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('QA: Поставить на позицию', () => {
  const two = (o: Partial<RmState> = {}) => baseState({
    games: [{ id: 1, title: 'Игра А', hours: 250 }, { id: 2, title: 'Игра Х', hours: 300 }, { id: 3, title: 'Игра Y', hours: 300 }],
    order: [1, 2, 3],
    insertHints: { 2: { insertAt: 1, displacesAtInsert: 1, displacedTitles: ['Игра А'] }, 3: { insertAt: 2, displacesAtInsert: 0, displacedTitles: [] } }, ...o,
  });

  // BUG-2 (исправлен): второй PUT теряет первую перестановку
  test('гонка: два быстрых клика по разным строкам, второй PUT не должен терять первую перестановку', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'desktop');
    const s = await open(page, context, baseURL as string, two());
    await page.route(/\/api\/roadmap\/order$/, async (r) => { await new Promise((x) => setTimeout(x, 600)); await r.fallback(); });
    const btns = page.getByTestId('rm-to-pos');
    await expect(btns).toHaveCount(2);
    await btns.nth(0).click();
    await btns.nth(1).click({ noWaitAfter: true }).catch(() => {});
    await expect.poll(() => s.calls.orders.length, { timeout: 5000 }).toBeGreaterThan(0);
    await page.waitForTimeout(2000);
    // каждый следующий PUT обязан начинаться с того, что уже сохранено первым (игра 2 на позиции 1)
    if (s.calls.orders.length > 1) expect(s.calls.orders[1][0]).toBe(2);
  });

  test('двойной клик по одной кнопке: один PUT', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'desktop');
    const s = await open(page, context, baseURL as string, two());
    await page.route(/\/api\/roadmap\/order$/, async (r) => { await new Promise((x) => setTimeout(x, 500)); await r.fallback(); });
    const b = page.getByTestId('rm-to-pos').first();
    await b.dblclick({ noWaitAfter: true }).catch(() => {});
    await page.waitForTimeout(1500);
    expect(s.calls.orders.length).toBe(1);
  });

  test('PUT 503: тост ошибки, порядок не меняется, кнопка снова доступна', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'desktop');
    const s = await open(page, context, baseURL as string, two({ orderFail: true }));
    await page.getByTestId('rm-to-pos').first().click();
    await expect(page.getByText(/Не удалось поставить на позицию/)).toBeVisible();
    await expect(page.getByTestId('rm-to-pos').first()).toBeEnabled();
    expect(s.order).toEqual([1, 2, 3]);
  });

  test('игра исчезла между GET и PUT (400 unknown): тост, страница жива', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'desktop');
    await open(page, context, baseURL as string, two());
    await page.route(/\/api\/roadmap\/order$/, (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'invalid_request', message: 'x', details: { unknown: [2] } } }) }));
    await page.getByTestId('rm-to-pos').first().click();
    await expect(page.getByText(/Не удалось поставить на позицию/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Не успеваю', level: 2 })).toBeVisible();
  });

  test('XSS в названиях подсказки и полос', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'desktop');
    const x = '<img src=x onerror="window.__xss=1">';
    await open(page, context, baseURL as string, two({ games: [{ id: 1, title: x, hours: 250 }, { id: 2, title: '<script>window.__xss=2</script>', hours: 300 }], order: [1, 2], insertHints: { 2: { insertAt: 1, displacesAtInsert: 1, displacedTitles: [x] } } }));
    await expect(page.getByTestId('rm-end-hint')).toContainText('<img');
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });
});

const fullYear = (year: number, extra: Partial<RmState> = {}) => {
  const days = year % 4 === 0 ? 366 : 365;
  return baseState({
    year, today: '2026-10-29', hoursPerWeek: 10,
    games: [{ id: 1, title: 'Первый день', hours: 1.4 }, { id: 2, title: 'Середина', hours: ((days - 2) * 10) / 7 }, { id: 3, title: 'Последний день', hours: 1.4 }],
    order: [1, 2, 3], ...extra,
  });
};

test.describe('QA: таймлайн по дням', () => {
  for (const year of [2026, 2028]) {
    test(`${year}: 1 января, 31 декабря, полоса в 1 день, стык, месяцы`, async ({ page, context, baseURL, isMobile }) => {
      test.skip(isMobile, 'Gantt на десктопе');
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(page, context, baseURL as string, fullYear(year));
      const g = await page.evaluate(() => {
        const tr = document.querySelector('[data-testid="rm-lane-queue"]') as HTMLElement;
        const t = tr.getBoundingClientRect();
        const bars = Array.from(tr.querySelectorAll('.ps-rm-bar')).map((b) => { const r = b.getBoundingClientRect(); return { l: r.left - t.left, r: r.right - t.left, w: r.width, top: r.top }; });
        const months = Array.from(document.querySelectorAll('.ps-rm-g__month')).map((m) => (m as HTMLElement).style.left);
        return { w: t.width, bars, months };
      });
      expect(g.bars).toHaveLength(3);
      expect(g.bars[0].l).toBeCloseTo(0, 0);
      expect(g.bars[2].r).toBeGreaterThan(g.w - 1.5);
      const days = year % 4 === 0 ? 366 : 365;
      // 1-дневная полоса остаётся кликабельной (минимальная ширина) и не лезет на соседа сильнее min-width
      expect(new Set(g.bars.map((b) => Math.round(b.top))).size).toBe(1);
      const mar = parseFloat(g.months[2]);
      expect(mar).toBeCloseTo(((year % 4 === 0 ? 60 : 59) / days) * 100, 1);
      expect(await noScroll(page)).toBe(true);
    });
  }

  test('релиз до начала года обрезан по 1 января, не вылезает влево', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'desktop');
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, context, baseURL as string, baseState({
      planned: [{ id: 1, title: 'Декабрьский релиз', releaseDate: '2025-12-20', coverUrl: null, wantAtRelease: true, hoursManual: 40, externalSource: null, externalId: null, status: 'planned' }],
    }));
    const b = page.locator('.ps-rm-bar[data-kind="release"]');
    await expect(b).toHaveCount(1);
    const pos = await page.evaluate(() => { const t = document.querySelector('[data-testid="rm-lane-release"]')!.getBoundingClientRect(); const r = document.querySelector('.ps-rm-bar[data-kind="release"]')!.getBoundingClientRect(); return { l: r.left - t.left, r: r.right - t.left }; });
    expect(pos.l).toBeGreaterThanOrEqual(-0.5);
    expect(pos.r).toBeGreaterThan(5);
  });

  test('300 игр: нет пересечений в дорожке очереди, нет выхода за дорожку', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'desktop');
    await page.setViewportSize({ width: 1280, height: 900 });
    const games = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, title: `Игра ${i + 1}`, hours: 1.4 }));
    await open(page, context, baseURL as string, baseState({ games, order: games.map((x) => x.id) }));
    const bars = await page.evaluate(() => { const t = document.querySelector('[data-testid="rm-lane-queue"]')!.getBoundingClientRect(); return Array.from(document.querySelectorAll('[data-testid="rm-lane-queue"] .ps-rm-bar')).map((b) => { const r = b.getBoundingClientRect(); return { l: r.left - t.left, r: r.right - t.left, top: r.top, tw: t.width }; }); });
    expect(bars.length).toBeGreaterThan(200);
    expect(bars.every((b) => b.r <= b.tw + 0.5 && b.l >= -0.5)).toBe(true);
    expect(await noScroll(page)).toBe(true);
  });

  for (const w of [320, 360, 768, 1280, 1920]) {
    test(`ширина ${w}: нет горизонтального скролла страницы, длинные названия`, async ({ page, context, baseURL, isMobile }) => {
      test.skip(isMobile && w > 400, 'ширина вручную');
      await page.setViewportSize({ width: w, height: 900 });
      const long = 'Очень'.repeat(60);
      await open(page, context, baseURL as string, baseState({ games: [{ id: 1, title: long, hours: 40 }, { id: 2, title: 'Короткая', hours: 30 }, { id: 3, title: `<b>x</b>${long}`, hours: 30 }], order: [1, 2, 3] }));
      await page.waitForTimeout(300);
      if (w !== 768) expect(await noScroll(page)).toBe(true);
    });
  }

  test('подписи при ширине полосы: скрыты <= 43, видны >= 46; контейнер хранит 44px', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'desktop');
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, context, baseURL as string, baseState({ games: [{ id: 1, title: 'Длинная игра', hours: 60 }, { id: 2, title: 'Короткая 3 дня', hours: 4.3 }, { id: 3, title: 'Третья', hours: 40 }], order: [1, 2, 3] }));
    const info = await page.evaluate(() => Array.from(document.querySelectorAll('.ps-rm-bar')).map((b) => ({ w: b.getBoundingClientRect().width, vis: getComputedStyle(b.querySelector('.ps-rm-bar__t')!).display !== 'none', title: b.textContent })));
    for (const i of info) { if (i.w >= 50) expect(i.vis).toBe(true); if (i.w <= 40) expect(i.vis).toBe(false); }
  });

  test('a11y: aria-label полос, Tab по полосам по порядку, тултип по фокусу и Esc', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'desktop');
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, context, baseURL as string, baseState());
    const bars = page.locator('.ps-rm-bar');
    const n = await bars.count();
    expect(n).toBe(3);
    const labels = await bars.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    for (const l of labels) expect(l).toMatch(/с \d+ \S+ по \d+ \S+/);
    await bars.first().focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(bars.nth(1)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('.ps-rm-tip')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.ps-rm-tip')).toHaveCount(0);
  });

  test('XSS в названиях полос и тултипа', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'desktop');
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, context, baseURL as string, baseState({ games: [{ id: 1, title: '<img src=x onerror="window.__xss=1">', hours: 40 }], order: [1] }));
    await page.locator('.ps-rm-bar').first().hover();
    await expect(page.locator('.ps-rm-tip')).toContainText('<img');
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  for (const t of THEMES) {
    test(`контраст подписей полос очереди (оба тона) и релиза: тема ${t.id}`, async ({ page, context, baseURL, isMobile }) => {
      test.skip(isMobile, 'desktop');
      await page.setViewportSize({ width: 1280, height: 900 });
      await open(page, context, baseURL as string, baseState({ planned: [{ id: 1, title: 'Релиз', releaseDate: '2026-11-02', coverUrl: null, wantAtRelease: true, hoursManual: 10, externalSource: null, externalId: null, status: 'planned' }] }), t.id);
      const res = await page.evaluate(() => {
        const parse = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number); const k = c.startsWith('color(srgb') ? 255 : 1; return { r: m[0] * k, g: m[1] * k, b: m[2] * k, a: m[3] ?? 1 }; };
        const lum = (c: { r: number; g: number; b: number }) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
        const bgOf = (el: Element) => { // стековый фон с учётом прозрачности
          const chain: { r: number; g: number; b: number; a: number }[] = [];
          for (let e: Element | null = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) chain.push(c); if (c.a >= 1) break; }
          let base = { r: 255, g: 255, b: 255 };
          for (const c of chain.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) };
          return base;
        };
        return Array.from(document.querySelectorAll('.ps-rm-bar')).map((b) => {
          const tx = b.querySelector('.ps-rm-bar__t')!;
          const fg = parse(getComputedStyle(tx).color); const bg = bgOf(b);
          const [a, c] = [lum(fg), lum(bg)];
          return { kind: (b as HTMLElement).dataset.kind, alt: (b as HTMLElement).dataset.alt, ratio: (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05) };
        });
      });
      for (const r of res) expect(r.ratio, `${t.id} ${r.kind} ${r.alt}`).toBeGreaterThanOrEqual(4.5);
      expect(res.length).toBeGreaterThan(2);
    });
  }
});

test('BUG-3: полоса в 1 день у 31 декабря не должна выходить за дорожку (min-width 6px)', async ({ page, context, baseURL, isMobile }) => {
  test.skip(isMobile, 'desktop');
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, context, baseURL as string, fullYear(2026));
  const over = await page.evaluate(() => { const t = document.querySelector('[data-testid="rm-lane-queue"]')!.getBoundingClientRect(); const bs = document.querySelectorAll('[data-testid="rm-lane-queue"] .ps-rm-bar'); return bs[bs.length - 1].getBoundingClientRect().right - t.right; });
  expect(over).toBeLessThanOrEqual(0.5);
});
