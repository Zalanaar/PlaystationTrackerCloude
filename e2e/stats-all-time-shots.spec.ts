// QA Фаз 25-26: снимки all-статистики, «Когда ты играешь», слайдов all-Итогов в 7 темах (десктоп, мобильный). Без SHOTS_DIR пропускается.
// Моки скопированы из stats-all-time.spec.ts (контракт §26). Запуск: SHOTS_DIR=docs/qa/phase-25-26 PW_CHROMIUM_PATH=/usr/bin/google-chrome npx playwright test -c e2e/qa.config.ts e2e/stats-all-time-shots.spec.ts
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const NOW = new Date(Date.now() + 3 * 3600_000);
const CUR = NOW.getUTCFullYear();
const FIRST_Y = CUR - 5;
const zeroC = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };

const game = (id: number, title: string, status: 'completed' | 'dropped' | null = null) => ({
  id, title, coverUrl: null, platform: 'PS5', playSeconds: 360000, hours: 100, playCount: 19, lastPlayedAt: '2026-03-10T10:00:00.000Z',
  status, completedAt: null, droppedAt: null, trophies: null, genres: [{ key: 'ACTION', label: 'Экшен' }],
});

const HOURS = Array.from({ length: 24 }, (_, i) => (i === 21 ? 48 : i === 22 ? 30 : i === 23 ? 12 : i < 4 ? 4 : 1));
const pattern = (hasData = true) => ({
  byHour: HOURS, byWeekday: [20, 15, 10, 8, 30, 62, 33], total: hasData ? 178 : 5, peakHour: 21, peakWeekday: 5, label: 'по времени трофеев', hasData,
});

type Opts = { unattributed?: number; noEstimate?: boolean; pattern?: boolean; empty?: boolean };

function statsAll(o: Opts) {
  const years = Array.from({ length: 6 }, (_, i) => FIRST_Y + i);
  const byYear = years.map((y, i) => ({
    year: y, hours: i === 1 ? 0 : 100 + i * 50, estimatedHours: o.noEstimate ? 0 : i < 3 ? (i === 1 ? 0 : 100 + i * 50) : 0,
    measuredHours: o.noEstimate ? (i === 1 ? 0 : 100 + i * 50) : i < 3 ? 0 : 100 + i * 50,
  }));
  const sum = byYear.reduce((a, b) => a + b.hours, 0);
  const un = o.unattributed ?? 0;
  const trophyYears = years.map((y, i) => ({ year: y, platinum: i % 2, gold: i, silver: 2 * i, bronze: 3 * i, total: (i % 2) + 6 * i }));
  const tc = trophyYears.reduce((a, y) => ({ platinum: a.platinum + y.platinum, gold: a.gold + y.gold, silver: a.silver + y.silver, bronze: a.bronze + y.bronze, total: a.total + y.total }), { ...zeroC });
  return {
    period: { type: 'all', year: CUR, month: null, from: `${FIRST_Y}-03-02`, to: `${CUR}-10-27`, fromUtc: null, toUtc: null },
    years: [...years].reverse(),
    header: o.empty ? { completed: 0, dropped: 0, hours: null, platinum: 0 } : { completed: 10, dropped: 3, hours: Math.round((sum + un) * 10) / 10, platinum: tc.platinum },
    hours: {
      byMonth: Array(12).fill(null), estimatedByMonth: Array(12).fill(0),
      estimatedHours: byYear.reduce((a, b) => a + b.estimatedHours, 0), hasEstimate: !o.noEstimate,
      firstSnapshotDate: `${FIRST_Y + 3}-03-04`, periodPartial: true, byYear, unattributed: un,
    },
    genres: { hasData: true, items: [{ key: 'ACTION', label: 'Экшен', value: 12.5, gameIds: [1] }], games: { 1: { id: 1, title: 'Игра Один', coverUrl: null } } },
    top: { byHours: [{ game: game(1, 'Игра Один', 'completed'), hours: 310.2, estimated: false }], byTrophies: [{ game: game(1, 'Игра Один'), points: 1200, counts: { platinum: 1, gold: 3, silver: 9, bronze: 20, total: 33 } }] },
    rareTrophies: { period: [], allTime: [] },
    trophies: { counts: tc, byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...zeroC })), byYear: trophyYears },
    finished: { groups: [], byYear: years.map((y, i) => ({ year: y, completed: i === 4 ? 0 : i + 1, dropped: i === 4 ? 0 : i % 3 })) },
    played: { games: {}, groups: [] },
    playPattern: o.pattern === false ? pattern(false) : pattern(true),
  };
}

function statsYear(u: URL, o: Opts) {
  const year = Number(u.searchParams.get('year') ?? CUR);
  const type = u.searchParams.get('period') === 'month' ? 'month' : 'year';
  return {
    period: { type, year, month: type === 'month' ? Number(u.searchParams.get('month')) : null, from: `${year}-01-01`, to: `${year}-12-31`, fromUtc: `${year}-01-01T00:00:00.000Z`, toUtc: `${year + 1}-01-01T00:00:00.000Z` },
    years: [CUR, CUR - 1],
    header: { completed: 1, dropped: 1, hours: 123.4, platinum: 2 },
    hours: { byMonth: Array(12).fill(null), estimatedByMonth: Array(12).fill(0), estimatedHours: 0, hasEstimate: false, firstSnapshotDate: null, periodPartial: false },
    genres: { hasData: false, items: [], games: {} },
    top: { byHours: [], byTrophies: [] },
    rareTrophies: { period: [], allTime: [] },
    trophies: { counts: { platinum: 2, gold: 3, silver: 4, bronze: 5, total: 14 }, byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...zeroC })) },
    finished: { groups: [] },
    played: { games: {}, groups: [] },
    playPattern: pattern(o.pattern !== false),
  };
}

type Ctl = { calls: URL[]; opts: Opts };
async function open(page: Page, context: BrowserContext, baseURL: string, url: string, opts: Opts = {}): Promise<Ctl> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  const ctl: Ctl = { calls: [], opts };
  await page.route(/\/api\/stats\?/, (r) => {
    const u = new URL(r.request().url());
    ctl.calls.push(u);
    const data = u.searchParams.get('period') === 'all' ? statsAll(ctl.opts) : statsYear(u, ctl.opts);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  });
  await page.goto(url);
  return ctl;
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const person = { onlineId: 'Artem_PS', avatarUrl: null };
function wrapped(scope: 'year' | 'all', opts: { pattern?: boolean; allAvailable?: boolean } = {}) {
  const hasPattern = opts.pattern !== false;
  const g1 = game(1, 'Horizon Forbidden West');
  const byYear = Array.from({ length: 6 }, (_, i) => ({ year: FIRST_Y + i, hours: 100 + i * 50, estimatedHours: i < 3 ? 100 + i * 50 : 0, measuredHours: i < 3 ? 0 : 100 + i * 50 }));
  const base = {
    year: CUR, mode: 'story', scope, allTimeAvailable: opts.allAvailable !== false, profile: person,
    period: { from: `${FIRST_Y}-03-02`, to: `${CUR}-10-27`, fromUtc: null, toUtc: null },
    years: [{ year: CUR, hasData: true }, { year: CUR - 1, hasData: true }, { year: FIRST_Y, hasData: true }],
    firstSnapshotDate: `${FIRST_Y + 3}-03-04`, periodPartial: true, emptyState: null,
    playPattern: pattern(hasPattern),
    topGames: { hasData: true, items: [{ rank: 1, seconds: 1, hours: 310.2, estimated: false, game: g1 }] },
    finished: { hasData: true, completed: { count: 10, items: [] }, dropped: { count: 3, items: [] }, busiestMonth: null },
    trophies: { hasData: true, counts: { platinum: 7, gold: 31, silver: 88, bronze: 240, total: 366 }, platinum: { first: null, last: null, rarest: null }, rare: [] },
    genres: { hasData: true, items: [{ key: 'ACTION', label: 'Экшен', value: 14.5 }, { key: 'RPG', label: 'Ролевые', value: 6 }, { key: 'OTHER', label: 'Другое', value: 2 }] },
    longestGame: { hasData: true, seconds: 1, hours: 310.2, estimated: false, playCount: 19, game: g1 },
  };
  if (scope === 'year') {
    return {
      ...base, allTime: null, slides: ['start', 'hours', 'trophies', ...(hasPattern ? ['playPattern'] : []), 'final'],
      hours: { hasData: true, total: 412.4, days: 17.2, byMonth: Array(12).fill(null), estimatedByMonth: Array(12).fill(0), estimatedHours: 0, hasEstimate: false, topMonth: null },
    };
  }
  return {
    ...base,
    allTime: {
      firstGame: { hasData: true, at: '2014-03-12T09:00:00.000Z', source: 'first_played', game: g1 },
      hoursByYear: { hasData: true, total: 2840.5, unattributed: 40, byYear },
      platinumByYear: { hasData: true, total: 33, items: Array.from({ length: 10 }, (_, i) => ({ year: CUR - 9 + i, count: i + 1 })) },
      busiestYear: { hasData: true, year: FIRST_Y + 5, hours: 350, estimated: false },
      topGenre: { hasData: true, key: 'ACTION', label: 'Экшен', value: 14.5 },
    },
    slides: ['start', 'firstGame', 'hours', 'platinumYears', 'busiestYear', 'genres', 'longestGame', ...(hasPattern ? ['playPattern'] : []), 'final'],
    hours: { hasData: true, total: 2840.5, days: 118.4, byMonth: Array(12).fill(null), estimatedByMonth: Array(12).fill(0), estimatedHours: 410.3, hasEstimate: true, topMonth: null },
  };
}

async function openWrapped(page: Page, context: BrowserContext, baseURL: string, url = '/wrapped', opts: { pattern?: boolean; allAvailable?: boolean } = {}) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  const calls: URL[] = [];
  await page.route(/\/api\/wrapped/, (r) => {
    const u = new URL(r.request().url());
    calls.push(u);
    const scope = u.searchParams.get('year') === 'all' ? 'all' : 'year';
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: wrapped(scope, opts) }) });
  });
  await page.goto(url);
  return calls;
}
const sid = (page: Page) => page.locator('.ps-story__stage').getAttribute('data-slide');


const SHOTS = process.env.SHOTS_DIR;
const THEMES = ['night', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5', 'graphite'] as const;
test.skip(!SHOTS, 'нужен SHOTS_DIR');
const setTheme = (page: Page, v: string) => page.evaluate((t) => { if (t === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }, v);

for (const theme of THEMES) {
  test(`stats all ${theme}`, async ({ page, context, baseURL }, info) => {
    await open(page, context, baseURL!, '/stats?period=all');
    await expect(page.getByRole('heading', { name: 'Когда ты играешь' })).toBeVisible();
    await setTheme(page, theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-stats-all-${theme}.png`, fullPage: true });
    await page.getByRole('heading', { name: 'Когда ты играешь' }).scrollIntoViewIfNeeded();
    await page.locator('.ps-st-panel', { has: page.getByRole('heading', { name: 'Когда ты играешь' }) }).screenshot({ path: `${SHOTS}/${info.project.name}-pattern-${theme}.png` });
  });

  test(`wrapped all ${theme}`, async ({ page, context, baseURL }, info) => {
    await openWrapped(page, context, baseURL!, '/wrapped?year=all');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setTheme(page, theme);
    await page.getByRole('button', { name: 'Смотреть итоги за всё время' }).click();
    await expect(page.getByRole('dialog', { name: 'Итоги за всё время' })).toBeVisible();
    for (let i = 0; i < 9; i++) {
      const id = await sid(page);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      if (theme === 'night' || ['platinumYears', 'busiestYear', 'playPattern', 'firstGame'].includes(id ?? '')) {
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${SHOTS}/${info.project.name}-wrapped-${theme}-${i + 1}-${id}.png` });
      }
      if (i < 8) await page.keyboard.press('ArrowRight');
    }
  });
}

// Ширина 375 (iPhone SE/mini): без горизонтального переполнения на all-статистике и во всех слайдах all-Итогов
for (const theme of ['night', 'ps3'] as const) {
  test(`375px ${theme}`, async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'mobile', 'только мобильный проект');
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, context, baseURL!, '/stats?period=all');
    await expect(page.getByRole('heading', { name: 'Когда ты играешь' })).toBeVisible();
    await setTheme(page, theme);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/w375-stats-all-${theme}.png`, fullPage: true });
    await openWrapped(page, context, baseURL!, '/wrapped?year=all');
    await page.getByRole('button', { name: 'Смотреть итоги за всё время' }).click();
    for (let i = 0; i < 9; i++) {
      expect(await overflow(page), `слайд ${i + 1}`).toBeLessThanOrEqual(0);
      if (i === 3 || i === 7) await page.screenshot({ path: `${SHOTS}/w375-wrapped-${theme}-${i + 1}.png` });
      if (i < 8) await page.keyboard.press('ArrowRight');
    }
  });
}
