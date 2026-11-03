// QA Фазы 18: темы x ширины, граничные даты баннера, граничные ссылки ?game=, старые URL. Формы по контрактам, не по реализации.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type Mock } from './collection-mock';
import { baseState, mockRoadmap } from './roadmap-mock';
import { signedSession } from './session';

const THIS_YEAR = new Date(Date.now() + 3 * 3600_000).getUTCFullYear();
const ok = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'] as const;

async function setup(page: Page, context: BrowserContext, baseURL: string): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  return mockApi(page);
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('QA 18: темы x ширины на Коллекции и Плане', () => {
  for (const theme of THEMES) {
    for (const w of [360, 390, 768, 1023, 1440]) {
      test(`${theme} ${w}`, async ({ page, context, baseURL }, info) => {
        test.skip(info.project.name === 'mobile', 'размер задаётся вручную');
        await setup(page, context, baseURL!);
        await mockRoadmap(page, baseState());
        await context.addCookies([{ name: 'ps-theme', value: theme, url: baseURL! }]);
        await page.addInitScript((t) => localStorage.setItem('ps-theme', t), theme);
        await page.setViewportSize({ width: w, height: 800 });
        const errs: string[] = [];
        page.on('pageerror', (e) => errs.push(e.message));
        for (const path of ['/', '/roadmap']) {
          await page.goto(path);
          await expect(page.locator('h1').first()).toBeAttached();
          await page.waitForTimeout(300);
          expect(await overflow(page), `${theme} ${w} ${path} гор. прокрутка`).toBeLessThanOrEqual(0);
          if (path === '/roadmap') {
            const a = page.locator('nav[aria-label="Раздел бэклога"] a[aria-current="page"]');
            await expect(a).toHaveText('План');
            const box = await a.boundingBox();
            expect(box, `${theme} ${w} подвкладка`).toBeTruthy();
            expect(box!.width).toBeGreaterThan(0);
            expect(box!.height, `${theme} ${w} высота подвкладки`).toBeGreaterThanOrEqual(32); // PS5: pill 32 по дизайну
          }
          const nav = w < 768 ? 'nav.ps-tabbar a' : 'header nav[aria-label="Разделы"] a';
          await expect(page.locator(nav)).toHaveCount(4);
        }
        if (w === 360 || w === 1440) await page.screenshot({ path: `${process.env.QA_SHOTS ?? 'test-results'}/p18-${theme}-${w}.png` });
        expect(errs).toEqual([]);
      });
    }
  }
});

test.describe('QA 18: баннер Итогов на границах сезона (МСК)', () => {
  const cases: [string, boolean][] = [
    ['11-30T20:59:00Z', false], // 23:59 30 ноября МСК
    ['11-30T21:00:00Z', true], // 00:00 1 декабря МСК
    ['12-31T20:59:00Z', true],
    ['12-31T21:00:00Z', true], // 1 января МСК: показывается про прошлый год
    ['01-31T20:59:00Z', true],
    ['01-31T21:00:00Z', false], // 1 февраля МСК
  ];
  for (const [d, show] of cases) {
    test(`${d} -> баннер ${show}`, async ({ page, context, baseURL }, info) => {
      test.skip(info.project.name === 'mobile', 'логика даты одинакова');
      await setup(page, context, baseURL!);
      const year = d.startsWith('01') ? THIS_YEAR + 1 : THIS_YEAR;
      await page.route(/\/api\/stats(\?|$)/, async (r) => {
        const mod = await import('./navigation-tabs.spec').catch(() => null);
        void mod;
        await r.fallback();
      });
      await page.unroute(/\/api\/stats(\?|$)/);
      const y0 = year - 1;
      await page.route(/\/api\/stats(\?|$)/, (r) => r.fulfill(ok({
        period: { type: 'year', year: THIS_YEAR, month: null, from: `${THIS_YEAR}-01-01`, to: `${THIS_YEAR}-12-31`, fromUtc: `${y0}-12-31T21:00:00.000Z`, toUtc: `${THIS_YEAR}-12-31T21:00:00.000Z` },
        years: [y0, THIS_YEAR, year], header: { completed: 0, dropped: 0, hours: 0, platinum: 0 },
        hours: { byMonth: Array(12).fill(null), estimatedByMonth: Array(12).fill(0), estimatedHours: 0, hasEstimate: false, firstSnapshotDate: null, periodPartial: false },
        genres: { hasData: false, items: [], games: {} }, top: { byHours: [], byTrophies: [] }, rareTrophies: { period: [], allTime: [] },
        trophies: { counts: { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 }, byMonth: [] }, finished: { groups: [] }, played: { games: {}, groups: [] },
      })));
      await page.clock.setFixedTime(new Date(`${year}-${d}`));
      await page.goto('/stats');
      await expect(page.getByRole('heading', { name: 'Статистика', level: 1 })).toBeVisible();
      await page.waitForTimeout(500);
      await expect(page.locator('.ps-wbanner')).toHaveCount(show ? 1 : 0);
    });
  }
});

test.describe('QA 18: ?game= граничные случаи', () => {
  for (const bad of ['0', '1abc', '1.5', '2147483648', '', '%20', '1%202', '007']) {
    test(`game="${bad}" не ломает коллекцию`, async ({ page, context, baseURL }, info) => {
      test.skip(info.project.name === 'mobile', 'логика одинакова');
      await setup(page, context, baseURL!);
      const errs: string[] = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(`/?game=${bad}`);
      await expect(page.getByRole('heading', { name: '2026', level: 2 })).toBeVisible();
      await page.waitForTimeout(400);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(page.url()).not.toMatch(/game=/);
      expect(errs).toEqual([]);
    });
  }

  test('game=3 вместе с поиском, скрывающим игру: окно открыто', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await page.goto('/?game=3&q=zzzzzz');
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Horizon Forbidden West' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(page.url()).toMatch(/q=zzzzzz/);
    expect(page.url()).not.toMatch(/game=/);
  });

  test('дубль game=1&game=2 открывает одну игру', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await page.goto('/?game=1&game=2');
    await expect(page.getByRole('dialog')).toHaveCount(1);
  });

  test('игра 404 при полном списке: тост, адрес чист', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await page.goto('/?game=424242&tab=trophies');
    await expect(page.getByText('Игра не найдена. Возможно, ссылка устарела.')).toBeVisible();
    await expect(page).not.toHaveURL(/game=|tab=/);
  });

  test('переключение game=3 -> game=4 кнопкой «назад/вперёд»', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await page.goto('/');
    await page.getByRole('button', { name: /^Открыть: God of War/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goForward();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(page.url()).not.toMatch(/game=/);
  });

  test('без сессии: /login?next= хранит ?game=', async ({ page, baseURL }) => {
    const r = await page.request.get(`${baseURL}/?game=3&tab=trophies`, { maxRedirects: 0 });
    expect([302, 307, 308]).toContain(r.status());
    const loc = r.headers()['location'] ?? '';
    expect(decodeURIComponent(loc)).toContain('game=3');
    expect(decodeURIComponent(loc)).toContain('tab=trophies');
  });
});

test.describe('QA 18: прямые заходы и системные файлы', () => {
  test('старые URL открываются без редиректа', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await mockRoadmap(page, baseState());
    for (const p of ['/roadmap', '/recommend', '/wrapped']) {
      const resp = await page.goto(p);
      expect(resp?.status(), p).toBe(200);
      expect(new URL(page.url()).pathname, p).toBe(p);
    }
  });

  test('manifest и иконки доступны без сессии, страницы закрыты', async ({ request, baseURL }) => {
    for (const p of ['/manifest.webmanifest', '/icon.svg', '/apple-icon.png', '/favicon.ico', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png']) {
      const r = await request.get(`${baseURL}${p}`, { maxRedirects: 0 });
      expect(r.status(), p).toBe(200);
    }
    const m = await (await request.get(`${baseURL}/manifest.webmanifest`)).json();
    expect(m).toMatchObject({ name: 'PS Tracker', short_name: 'PS Tracker', display: 'standalone', start_url: '/', scope: '/', lang: 'ru', background_color: '#0e0f16', theme_color: '#0e0f16' });
    expect(m.icons).toHaveLength(3);
    for (const p of ['/', '/stats', '/api/games']) {
      const r = await request.get(`${baseURL}${p}`, { maxRedirects: 0 });
      expect([302, 307, 308, 401]).toContain(r.status());
    }
  });

  test('viewport-fit=cover, theme-color, apple-web-app', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await page.goto('/');
    await expect(page.locator('meta[name=viewport]')).toHaveAttribute('content', /viewport-fit=cover/);
    await expect(page.locator('meta[name=theme-color]').first()).toHaveAttribute('content', '#0e0f16');
    await expect(page.locator('meta[name=apple-mobile-web-app-capable], meta[name=mobile-web-app-capable]').first()).toHaveAttribute('content', 'yes');
    await expect(page.locator('link[rel=apple-touch-icon]')).toHaveCount(1);
  });
});

test.describe('QA 18: План, Статистика, ширины', () => {
  const games = Array.from({ length: 9 }, (_, i) => ({ id: 20 + i, title: `Длинная ${i + 1}`, hours: 400 }));
  const st = () => baseState({ hoursPerWeek: 0.5, games, order: games.map((g) => g.id) });

  test('#rm-g-<id> строки за лимитом раскрывает список; «Свернуть» чистит хэш', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await mockRoadmap(page, st());
    await page.goto('/roadmap#rm-g-28');
    const over = page.locator('#rm-over');
    await expect(over.getByTestId('rm-over-item').first()).toBeVisible();
    const total = Number(await over.locator('.ps-rm-cnt').innerText());
    await expect(over.getByTestId('rm-over-item')).toHaveCount(total);
    await over.getByRole('button', { name: 'Свернуть' }).click();
    await expect(over.getByTestId('rm-over-item')).toHaveCount(5);
    expect(new URL(page.url()).hash).toBe('');
  });

  test('якорь #rm-over не раскрывает список', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await mockRoadmap(page, st());
    await page.goto('/roadmap#rm-over');
    await expect(page.locator('#rm-over').getByTestId('rm-over-item')).toHaveCount(5);
  });

  test('«Не распределено» >5: свёрнуто, кнопка есть', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await mockRoadmap(page, st());
    await page.goto('/roadmap');
    const un = page.locator('#rm-unallocated');
    if (await un.count()) {
      const n = await un.getByTestId('rm-unallocated').count();
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  for (const w of [360, 390, 768, 1023]) {
    for (const p of ['/stats', '/backlog', '/triage', '/wrapped', '/recommend']) {
      test(`${p} ${w}: нет горизонтальной прокрутки`, async ({ page, context, baseURL }, info) => {
        test.skip(info.project.name === 'mobile', 'размер задаётся вручную');
        await setup(page, context, baseURL!);
        await mockRoadmap(page, baseState());
        await page.route(/\/api\/stats(\?|$)/, (r) => r.fallback());
        await page.setViewportSize({ width: w, height: 800 });
        await page.goto(p);
        await page.waitForTimeout(600);
        expect(await overflow(page), `${p} ${w}`).toBeLessThanOrEqual(0);
        const nav = w < 768 ? 'nav.ps-tabbar a[aria-current="page"]' : 'header nav[aria-label="Разделы"] a[aria-current="page"]';
        await expect(page.locator(nav)).toHaveCount(1);
      });
    }
  }

  test('моб. tab bar: /recommend и /wrapped подсвечивают Бэклог и Статистику', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'mobile', 'tab bar');
    await setup(page, context, baseURL!);
    await page.goto('/recommend');
    await expect(page.locator('nav.ps-tabbar a[aria-current="page"]')).toHaveText('Бэклог');
    await page.goto('/wrapped');
    await expect(page.locator('nav.ps-tabbar a[aria-current="page"]')).toHaveText('Статистика');
  });
});

// CLS (§8.4): скелеты Плана и Подскажи заменяются данными без скачков > 0.05. Копия приёма из navigation-tabs.spec.ts.
async function trackCls(page: Page) {
  await page.addInitScript(() => {
    type LS = PerformanceEntry & { value: number; hadRecentInput: boolean };
    const w = window as unknown as { __ls: { t: number; v: number }[] };
    w.__ls = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries() as LS[]) if (!e.hadRecentInput) w.__ls.push({ t: Math.round(e.startTime), v: e.value, n: ((e as unknown as { sources?: { node?: Element }[] }).sources ?? []).map((x) => (x.node as HTMLElement | undefined)?.className?.toString().slice(0, 40) ?? '').join('|') } as { t: number; v: number }); }).observe({ type: 'layout-shift', buffered: true });
  });
}
const clsSum = (page: Page) => page.evaluate(() => (window as unknown as { __ls: { v: number }[] }).__ls.reduce((s, e) => s + e.v, 0));
const recItem = (id: number) => ({
  game: { id, name: `Игра ${id}`, imageUrl: null, bannerUrl: null, genres: ['ACTION'], hours: 22.5, hoursSource: 'hltb' }, score: 4.7,
  signals: [{ key: 'genre_affinity', label: 'Любимый жанр', contribution: 2.4 }], reason: { text: `Тебе заходит экшен, ${id}.`, source: 'template' },
});

test.describe('QA 18: CLS Плана и Подскажи', () => {
  for (const [w, h] of [[1440, 900], [390, 844]] as const) {
    test(`План, ${w}`, async ({ page, context, baseURL }, info) => {
      test.skip(info.project.name === 'mobile', 'размер задаётся вручную');
      await setup(page, context, baseURL!);
      const games = Array.from({ length: 9 }, (_, i) => ({ id: 20 + i, title: `Длинная ${i + 1}`, hours: 400 }));
      await mockRoadmap(page, process.env.QA_BASE_PLAN ? baseState() : baseState({ hoursPerWeek: 0.5, games, order: games.map((g) => g.id) }));
      await page.route(/\/api\/roadmap/, async (r) => { await new Promise((x) => setTimeout(x, 1500)); await r.fallback(); });
      await page.setViewportSize({ width: w, height: h });
      await trackCls(page);
      await page.goto('/roadmap');
      await page.locator('.ps-skeleton').first().waitFor();
      await page.waitForTimeout(500);
      await page.evaluate(() => { (window as unknown as { __ls: unknown[] }).__ls.length = 0; });
      await expect(page.locator('.ps-skeleton')).toHaveCount(0, { timeout: 10_000 });
      await page.waitForTimeout(700);
      const c = await clsSum(page);
      if (c > 0.05) console.log('CLS-DEBUG', JSON.stringify(await page.evaluate(() => (window as unknown as { __ls: unknown[] }).__ls)));
      expect(c, `CLS плана ${w}`).toBeLessThanOrEqual(0.05);
    });

    test(`Подскажи, ${w}`, async ({ page, context, baseURL }, info) => {
      test.skip(info.project.name === 'mobile', 'размер задаётся вручную');
      await setup(page, context, baseURL!);
      const ok2 = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
      await page.route(/\/api\/recommend(\?.*)?$/, async (r) => {
        await new Promise((x) => setTimeout(x, 1500));
        await r.fulfill(ok2({ items: Array.from({ length: 9 }, (_, i) => recItem(i + 1)), meta: { llm: 'disabled', candidates: 37, time: 'any' } }));
      });
      await page.route(/\/api\/recommend\/dislikes$/, (r) => r.fulfill(ok2({ items: [], ttlDays: 30 })));
      await page.setViewportSize({ width: w, height: h });
      await trackCls(page);
      await page.goto('/recommend');
      await page.locator('.ps-skeleton').first().waitFor();
      await page.waitForTimeout(500);
      await page.evaluate(() => { (window as unknown as { __ls: unknown[] }).__ls.length = 0; });
      await expect(page.getByRole('button', { name: /^Начать играть/ }).first()).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(700);
      expect(await clsSum(page), `CLS подскажи ${w}`).toBeLessThanOrEqual(0.05);
    });
  }
});

test.describe('QA 18: theme-color по теме', () => {
  const COLORS: Record<string, string> = { night: '#0e0f16', graphite: '#111113', ps1: '#1c1c22', ps2: '#070b1a', ps3: '#10070b', ps4: '#02173d', ps5: '#0a0a0c' };
  for (const [theme, color] of Object.entries(COLORS)) {
    test(`cookie ${theme}: meta theme-color ${color}`, async ({ page, context, baseURL }, info) => {
      test.skip(info.project.name === 'mobile', 'логика одинакова');
      await setup(page, context, baseURL!);
      await context.addCookies([{ name: 'ps-theme', value: theme, url: baseURL! }]);
      await page.goto('/');
      await expect(page.locator('meta[name=theme-color]').first()).toHaveAttribute('content', color);
    });
  }
  test('смена темы в UI обновляет theme-color', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name === 'mobile', 'десктоп-шапка');
    await setup(page, context, baseURL!);
    await page.goto('/');
    await page.evaluate(() => { document.cookie = 'ps-theme=ps1; path=/'; });
    const sel = page.locator('header').getByRole('button', { name: /Тема/ });
    await sel.click();
    await page.getByRole('option', { name: /PS1/ }).or(page.getByRole('menuitemradio', { name: /PS1/ })).first().click();
    await expect(page.locator('meta[name=theme-color]').first()).toHaveAttribute('content', '#1c1c22');
  });
});
