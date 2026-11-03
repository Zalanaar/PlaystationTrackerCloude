// QA Фазы 18, повторная приёмка: переход на /?game=<id> со Статистики, Бэклога, Подскажи («Из бэклога»); «назад» возвращает на исходную страницу.
// Проверяется и на desktop, и на mobile (Pixel 7). Контракт §8.6, не реализация.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';
import { baseState, buildRoadmap, mockRoadmap } from './roadmap-mock';

const THIS_YEAR = new Date(Date.now() + 3 * 3600_000).getUTCFullYear();
const z = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };
const ok = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });

async function setup(page: Page, context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
}

function stats(u: URL) {
  const year = Number(u.searchParams.get('year') ?? THIS_YEAR);
  const g = { id: 1, title: 'The Witcher 3: Wild Hunt', coverUrl: null, platform: 'PS5', playSeconds: 36000, hours: 10, playCount: 3, lastPlayedAt: `${THIS_YEAR}-03-10T10:00:00.000Z`, status: 'completed', completedAt: `${THIS_YEAR}-03-10T10:00:00.000Z`, droppedAt: null, trophies: null, genres: [{ key: 'ACTION', label: 'Экшен' }] };
  const rare = { setId: 1, trophyId: 7, type: 'gold', name: 'Редкий кубок', detail: null, iconUrl: null, earnedAt: `${THIS_YEAR}-03-02T19:10:00.000Z`, earnedRate: 1.5, rarity: 0, setName: 'X', game: { id: 3, title: 'Horizon Forbidden West', coverUrl: null } };
  return {
    period: { type: 'year', year, month: null, from: `${year}-01-01`, to: `${year}-12-31`, fromUtc: `${year - 1}-12-31T21:00:00.000Z`, toUtc: `${year}-12-31T21:00:00.000Z` },
    years: [THIS_YEAR], header: { completed: 1, dropped: 0, hours: 50, platinum: 1 },
    hours: { byMonth: Array(12).fill(null).map((_, i) => (i < 3 ? 10 : null)), estimatedByMonth: Array(12).fill(0), estimatedHours: 0, hasEstimate: false, firstSnapshotDate: `${THIS_YEAR}-01-15`, periodPartial: false },
    genres: { hasData: true, items: [{ key: 'ACTION', label: 'Экшен', value: 3, gameIds: [1] }], games: { 1: { id: 1, title: g.title, coverUrl: null } } },
    top: { byHours: [{ game: g, hours: 12.5, estimated: false }], byTrophies: [] },
    rareTrophies: { period: [rare], allTime: [rare] },
    trophies: { counts: { platinum: 1, gold: 1, silver: 1, bronze: 1, total: 4 }, byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...z })) },
    finished: { groups: [] },
    played: { games: { 1: g }, groups: [{ month: `${year}-03`, year, monthNumber: 3, completed: 1, dropped: 0, items: [{ gameId: 1, hours: 12.5, estimated: false, finished: 'completed', finishedAt: `${THIS_YEAR}-03-10T10:00:00.000Z` }] }] },
  };
}
async function mockStats(page: Page) {
  await page.route(/\/api\/stats(\?|$)/, (r) => r.fulfill(ok(stats(new URL(r.request().url())))));
}
const recItem = (id: number, name: string) => ({
  game: { id, name, imageUrl: null, bannerUrl: null, genres: ['ACTION'], hours: 22.5, hoursSource: 'hltb' },
  score: 4.7, signals: [{ key: 'genre_affinity', label: 'Любимый жанр', contribution: 2.4 }], reason: { text: `Причина ${id}.`, source: 'template' },
});
async function mockRecommend(page: Page) {
  await page.route(/\/api\/recommend(\?.*)?$/, (r) => r.fulfill(ok({ items: [recItem(3, 'Horizon Forbidden West'), recItem(4, 'God of War')], meta: { llm: 'disabled', candidates: 37, time: 'any' } })));
  await page.route(/\/api\/recommend\/dislikes$/, (r) => r.fulfill(ok({ items: [], ttlDays: 30 })));
}

const path = (page: Page) => new URL(page.url()).pathname;
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const dlg = (page: Page) => page.getByRole('dialog');

/** Общий сценарий: открыть игру кликом, проверить адрес, «назад», «вперёд», закрыть ✕ — вернулись на исходную страницу. */
async function scenario(page: Page, start: string, id: number, click: () => Promise<void>, heading: string, tab?: string) {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(start);
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  await click();
  await expect(dlg(page)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/\\?game=${id}${tab ? `&tab=${tab}` : ''}$`));
  expect(path(page)).toBe('/');
  if (tab === 'trophies') await expect(dlg(page).getByRole('tab', { name: /Трофеи/ })).toHaveAttribute('aria-selected', 'true');
  // «назад» возвращает на исходную страницу, окно закрыто
  await page.goBack();
  await expect(dlg(page)).toHaveCount(0);
  expect(path(page)).toBe(start.split('?')[0]);
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  expect(page.url()).not.toMatch(/game=/);
  // «вперёд» открывает снова, ✕ возвращает на исходную страницу
  await page.goForward();
  await expect(dlg(page)).toBeVisible();
  await expect(page).toHaveURL(/[?&]game=/);
  // под нагрузкой CI клик по ✕ мог прийти до того, как окно после popstate дорисовалось (флейк в mobile): повтор клика, пока окно не закроется
  await expect(async () => {
    if (await dlg(page).count()) await dlg(page).getByRole('button', { name: 'Закрыть' }).click({ timeout: 2000 });
    await expect(dlg(page)).toHaveCount(0, { timeout: 2000 });
  }).toPass({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  expect(path(page)).toBe(start.split('?')[0]);
  expect(errs).toEqual([]);
}

test.describe('QA 18b: переход на /?game= с других страниц', () => {
  test('Статистика: карточка игры', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await mockStats(page);
    await scenario(page, '/stats', 1, () => page.getByRole('button', { name: /^Открыть: The Witcher 3/ }).first().click(), 'Статистика');
  });

  test('Статистика: редкий трофей открывает вкладку «Трофеи»', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await mockStats(page);
    await scenario(page, '/stats', 3, () => page.locator('.ps-rare__btn').first().click(), 'Статистика', 'trophies');
  });

  test('Бэклог: карточка игры', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await scenario(page, '/backlog', 6, () => page.getByRole('button', { name: /^Открыть: Stray/ }).first().click(), 'Бэклог');
  });

  test('Подскажи «Из бэклога»: название игры', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await mockRecommend(page);
    await scenario(page, '/recommend', 3, () => page.getByRole('button', { name: 'Horizon Forbidden West', exact: true }).first().click(), 'Подскажи');
  });

  test('Подскажи «Из бэклога»: обложка', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await mockRecommend(page);
    await scenario(page, '/recommend', 3, () => page.locator('.ps-rec__mediabtn').first().click({ force: true }), 'Подскажи');
  });

  test('прямая ссылка + «назад» уходит на предыдущую страницу; ✕ остаётся на «/»', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await mockStats(page);
    await page.goto('/stats');
    await expect(page.getByRole('heading', { name: 'Статистика', level: 1 })).toBeVisible();
    await page.goto('/?game=3');
    await expect(dlg(page).getByRole('heading', { name: 'Horizon Forbidden West' })).toBeVisible();
    // ✕ при прямой ссылке: replace, остаёмся на «/», без ухода со страницы
    await dlg(page).getByRole('button', { name: 'Закрыть' }).click();
    await expect(dlg(page)).toHaveCount(0);
    expect(path(page)).toBe('/');
    expect(page.url()).not.toMatch(/game=/);
    // «назад» из прямой ссылки без закрытия: на предыдущую страницу
    await page.goto('/stats');
    await expect(page.getByRole('heading', { name: 'Статистика', level: 1 })).toBeVisible();
    await page.goto('/?game=3');
    await expect(dlg(page)).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Статистика', level: 1 })).toBeVisible();
    expect(path(page)).toBe('/stats');
    await expect(dlg(page)).toHaveCount(0);
  });

  test('прямая ссылка: Esc закрывает окно и остаётся на «/»', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await page.goto('/?game=3&tab=trophies');
    await expect(dlg(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg(page)).toHaveCount(0);
    expect(path(page)).toBe('/');
    expect(page.url()).not.toMatch(/game=|tab=/);
  });
});

// CLS Плана на 390 по каждому состоянию панели «Прогресс» (ProgressPanel.tsx): скелет заменяется данными без скачков > 0.05.
async function trackCls(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __ls: { v: number; n: string }[] };
    w.__ls = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Element }[] })[]) {
        if (!e.hadRecentInput) w.__ls.push({ v: e.value, n: (e.sources ?? []).map((x) => (x.node as HTMLElement | undefined)?.className?.toString().slice(0, 30) ?? '').join('|') });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

type Patch = (d: Record<string, unknown>) => void;
const PROGRESS_STATES: [string, { year?: number; patch?: Patch }][] = [
  ['behind (мок)', {}],
  ['onTrack', { patch: (d) => { d.progress = { ...(d.progress as object), status: 'onTrack', diffHours: 0.5, actualHours: 281 }; } }],
  ['ahead', { patch: (d) => { d.progress = { ...(d.progress as object), status: 'ahead', diffHours: 30, actualHours: 310 }; } }],
  ['no_data', { patch: (d) => { d.progress = { ...(d.progress as object), status: 'no_data', actualHours: 0, diffHours: 0 }; } }],
  ['not_started', { patch: (d) => { d.progress = { ...(d.progress as object), status: 'not_started' }; } }],
  ['empty (нет игр в плане)', { patch: (d) => { d.items = []; } }],
  ['past (год прошлый)', { year: 2025 }],
];
test.describe('QA 18b: CLS Плана 390 по состояниям «Прогресс»', () => {
  for (const [name, cfg] of PROGRESS_STATES) {
    for (const plan of ['9 игр', 'базовый']) {
      test(`${name}, ${plan}`, async ({ page, context, baseURL }, info) => {
        test.skip(info.project.name === 'mobile', 'размер задаётся вручную');
        await setup(page, context, baseURL!);
        const games = Array.from({ length: 9 }, (_, i) => ({ id: 20 + i, title: `Длинная ${i + 1}`, hours: 400 }));
        const st = plan === '9 игр' ? baseState({ hoursPerWeek: 0.5, games, order: games.map((g) => g.id) }) : baseState();
        if (cfg.year) st.year = cfg.year;
        await mockRoadmap(page, st);
        await page.route(/\/api\/roadmap(\?|$)/, async (r) => {
          await new Promise((x) => setTimeout(x, 1500));
          const d = buildRoadmap(st) as unknown as Record<string, unknown>;
          cfg.patch?.(d);
          await r.fulfill(ok(d));
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await trackCls(page);
        await page.goto('/roadmap');
        await page.locator('.ps-skeleton').first().waitFor();
        await page.waitForTimeout(500);
        await page.evaluate(() => { (window as unknown as { __ls: unknown[] }).__ls.length = 0; });
        await expect(page.locator('.ps-skeleton')).toHaveCount(0, { timeout: 10_000 });
        await page.waitForTimeout(700);
        const ls = await page.evaluate(() => (window as unknown as { __ls: { v: number; n: string }[] }).__ls);
        const c = ls.reduce((s, e) => s + e.v, 0);
        console.log(`CLS[${name} / ${plan}] = ${c.toFixed(4)} ${c > 0 ? JSON.stringify(ls) : ''}`);
        await expect(page.locator('.ps-rm-panel[data-area="prog"]')).toBeVisible();
        expect(c, `CLS ${name} ${plan}`).toBeLessThan(0.05);
      });
    }
  }
});

// N-3: PS5 на мобильном, подвкладки: зона нажатия >= 44, равные ячейки, pill внутри ячейки.
test.describe('QA 18b: PS5 подвкладки, зона нажатия', () => {
  for (const w of [360, 390]) {
    for (const path of ['/roadmap', '/backlog', '/recommend']) {
      test(`ps5 ${w} ${path}`, async ({ page, context, baseURL }, info) => {
        test.skip(info.project.name === 'mobile', 'размер задаётся вручную');
        await setup(page, context, baseURL!);
        await mockRoadmap(page, baseState());
        await mockRecommend(page);
        await context.addCookies([{ name: 'ps-theme', value: 'ps5', url: baseURL! }]);
        await page.addInitScript(() => localStorage.setItem('ps-theme', 'ps5'));
        await page.setViewportSize({ width: w, height: 800 });
        await page.goto(path);
        const nav = page.locator('nav[aria-label="Раздел бэклога"]');
        await expect(nav.locator('a')).toHaveCount(3);
        await page.waitForTimeout(300);
        const cells = await nav.locator('a').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, r: r.right, cur: e.getAttribute('aria-current') === 'page' }; }));
        for (const c of cells) expect(c.h, `высота ячейки ${JSON.stringify(c)}`).toBeGreaterThanOrEqual(44);
        const ws = cells.map((c) => c.w);
        expect(Math.max(...ws) - Math.min(...ws), `ширины ${ws}`).toBeLessThanOrEqual(1);
        const pill = await nav.locator('a[aria-current="page"]').evaluate((e) => { const s = getComputedStyle(e, '::before'); const r = e.getBoundingClientRect(); return { h: parseFloat(s.height), content: s.content, cw: r.width, ch: r.height }; });
        expect(pill.content, 'pill рисуется ::before').not.toBe('none');
        expect(pill.h).toBeLessThanOrEqual(pill.ch);
        expect(await overflow(page)).toBeLessThanOrEqual(0);
        await nav.screenshot({ path: `${process.env.QA_SHOTS ?? 'test-results'}/p18b-ps5-subnav-${w}${path.replace('/', '-')}.png` });
        if (path === '/roadmap') await page.screenshot({ path: `${process.env.QA_SHOTS ?? 'test-results'}/p18b-ps5-page-${w}.png` });
      });
    }
  }
});
