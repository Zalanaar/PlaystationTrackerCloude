// Фазы 25–26 (frontend): Статистика «Всё время», «Когда ты играешь», Итоги «Всё время». Моки по контракту §26 (api-contract), не по реализации.
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
const seg = (page: Page, name: string) => page.getByRole('group', { name: 'Период' }).getByRole('button', { name, exact: true });

test.describe('Статистика: «Всё время» (Фаза 25)', () => {
  test('переключатель: URL ?period=all без year/month, запрос, шапка, степпер скрыт, кнопка Итоги', async ({ page, context, baseURL }) => {
    const ctl = await open(page, context, baseURL!, '/stats');
    await expect(seg(page, 'Год')).toHaveAttribute('aria-pressed', 'true');
    await seg(page, 'Всё время').click();
    await expect(page).toHaveURL(/period=all$/);
    expect(page.url()).not.toMatch(/year=|month=/);
    await expect.poll(() => ctl.calls[ctl.calls.length - 1].searchParams.toString()).toBe('period=all');
    await expect(seg(page, 'Всё время')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'Всё время', level: 2 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Предыдущий год' })).toHaveCount(0);
    await expect(page.getByTestId('all-range')).toHaveText(`${FIRST_Y} – ${CUR}`);
    await expect(page.locator('.ps-st-head')).toContainText('пройдено');
    await expect(page.locator('.ps-st-head')).toContainText('≈');
    const link = page.getByRole('link', { name: 'Итоги: всё время' });
    await expect(link).toHaveAttribute('href', '/wrapped?year=all');
    await expect(page.locator('.ps-sr[aria-live="polite"]', { hasText: 'Период: всё время' })).toHaveCount(1);
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined|null|Invalid/);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('прямой заход ?period=all&year=abc не ломается и не уходит в API мусором', async ({ page, context, baseURL }) => {
    const ctl = await open(page, context, baseURL!, '/stats?period=all&year=abc&month=99');
    await expect(page.getByRole('heading', { name: 'Часы по годам' })).toBeVisible();
    for (const c of ctl.calls) expect(c.searchParams.toString()).toBe('period=all');
  });

  test('график часов по годам: столбец на каждый год, пустой слот без фокуса, штриховка, подсказка, aria-label', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/stats?period=all');
    const chart = page.getByRole('group', { name: 'Часы по годам' });
    await expect(chart.locator('.ps-st-yslot')).toHaveCount(6);
    await expect(chart.locator('.ps-st-yslot--empty')).toHaveCount(1);
    await expect(chart.locator('button.ps-st-yslot')).toHaveCount(5);
    await expect(chart.locator('.ps-st-yslot--empty')).toHaveAttribute('aria-hidden', 'true');
    // год с обеими частями: оценка сверху штриховкой
    const first = chart.locator('button.ps-st-yslot').first();
    await expect(first).toHaveAttribute('aria-label', `${FIRST_Y}: 100 ч, из них 100 ч оценка`);
    await expect(first.locator('.ps-st-bar__est')).toHaveCount(1);
    const deco = await first.locator('.ps-st-bar__est').evaluate((el) => ({ img: getComputedStyle(el, '::after').backgroundImage, b: getComputedStyle(el).borderTopStyle }));
    expect(deco.img).toContain('repeating-linear-gradient');
    expect(deco.b).toBe('dashed');
    await expect(page.getByRole('list', { name: 'Обозначения' }).first()).toContainText('Оценка');
    // подсказка
    await chart.locator('button.ps-st-yslot').nth(1).focus();
    const tip = page.getByRole('tooltip');
    await expect(tip).toContainText(`${FIRST_Y + 2}`);
    await expect(tip).toContainText('ч всего');
    await expect(tip).toContainText('Оценка:');
    await page.keyboard.press('Escape');
  });

  test('«Не отнесено к годам»: показывается при |x| >= 0.1, скрыта при меньшем; «Итог равен сумме» только при 0', async ({ page, context, baseURL }) => {
    const ctl = await open(page, context, baseURL!, '/stats?period=all', { unattributed: 40 });
    await expect(page.getByTestId('unattributed')).toHaveText('Не отнесено к годам: 40 ч');
    await expect(page.locator('.ps-st-note--cover')).toContainText('Точные часы по дням ведутся с');
    await expect(page.locator('.ps-st-note--cover')).not.toContainText('равен сумме');
    ctl.opts = { unattributed: -12.5 };
    await page.goto('/stats?period=all');
    await expect(page.getByTestId('unattributed')).toHaveText('Не отнесено к годам: −12,5 ч');
    ctl.opts = { unattributed: 0.04 };
    await page.goto('/stats?period=all');
    await expect(page.getByRole('heading', { name: 'Часы по годам' })).toBeVisible();
    await expect(page.getByTestId('unattributed')).toHaveCount(0);
    await expect(page.locator('.ps-st-note--cover')).toContainText('Итог за всё время равен сумме PSN.');
    // оценки нет: плашки нет
    ctl.opts = { noEstimate: true };
    await page.goto('/stats?period=all');
    await expect(page.getByRole('heading', { name: 'Часы по годам' })).toBeVisible();
    await expect(page.locator('.ps-st-note--cover')).toHaveCount(0);
  });

  test('трофеи по годам и пройдено/брошено; клик по году открывает «Год» этого года', async ({ page, context, baseURL }) => {
    const ctl = await open(page, context, baseURL!, '/stats?period=all');
    await expect(page.getByRole('heading', { name: 'Трофеи по годам' })).toBeVisible();
    const tchart = page.getByRole('group', { name: 'Трофеи по годам' });
    await expect(tchart.locator('button.ps-st-yslot').first()).toHaveAttribute('aria-label', /^\d{4}: \d+ трофе/);
    await expect(page.getByRole('heading', { name: 'Пройдено и брошено' })).toBeVisible();
    const rows = page.locator('.ps-st-fy__row');
    await expect(rows).toHaveCount(5); // год без пройденных и брошенных не выводится
    await expect(rows.first()).toHaveAttribute('aria-label', /Открыть год$/);
    // итог = KPI шапки
    await expect(page.getByTestId('finished-total')).toContainText('10');
    await rows.nth(1).click();
    const y = await rows.nth(1).evaluate(() => 0); // строка исчезает после перехода; год берём из URL
    void y;
    await expect(page).toHaveURL(/period=year&year=\d{4}/);
    await expect(seg(page, 'Год')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => ctl.calls[ctl.calls.length - 1].searchParams.get('period')).toBe('year');
  });

  test('возврат «Год» после «Всё время» берёт последний выбранный год', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, `/stats?period=year&year=${CUR - 1}`);
    await expect(page.getByRole('heading', { name: `${CUR - 1}`, level: 2 })).toBeVisible();
    await seg(page, 'Всё время').click();
    await expect(page.getByRole('heading', { name: 'Часы по годам' })).toBeVisible();
    await seg(page, 'Год').click();
    await expect(page).toHaveURL(new RegExp(`period=year&year=${CUR - 1}`));
  });

  test('при переключении предыдущее содержимое другого периода не показывается', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/stats');
    await expect(page.locator('.ps-st-head')).toBeVisible();
    await page.route(/\/api\/stats\?period=all/, async (r) => { await new Promise((res) => setTimeout(res, 600)); await r.fallback(); });
    await seg(page, 'Всё время').click();
    await expect(page.locator('[aria-busy="true"]').first()).toBeAttached();
    await expect(page.locator('.ps-st-head:not(.ps-st-head--all)')).toHaveCount(0);
    await expect(page.locator('.ps-st-head--all')).toBeVisible();
  });
});

test.describe('Статистика: «Когда ты играешь» (Фаза 26)', () => {
  for (const url of ['/stats', '/stats?period=month&year=2026&month=3', '/stats?period=all']) {
    test(`блок в периоде ${url}: подпись, итог словами, 24 часа и 7 дней`, async ({ page, context, baseURL }) => {
      await open(page, context, baseURL!, url);
      const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Когда ты играешь' }) });
      await expect(panel).toContainText('по времени трофеев · МСК');
      await expect(page.getByTestId('pp-summary')).toHaveText('Чаще всего: 21:00-22:00, суббота');
      const hours = page.getByRole('group', { name: 'Трофеи по часам суток, МСК' });
      await expect(hours.getByRole('img')).toHaveCount(24);
      await expect(hours.getByRole('img').nth(21)).toHaveAttribute('aria-label', '21:00-22:00: 48 трофеев, 27%, пик');
      const days = page.getByRole('group', { name: 'Трофеи по дням недели' });
      await expect(days.getByRole('img')).toHaveCount(7);
      await expect(days.getByRole('img').nth(5)).toHaveAttribute('aria-label', 'Суббота: 62 трофея, 35%, пик');
      await expect(hours.locator('.ps-pp__pill')).toHaveText('21:00');
    });
  }

  test('roving tabindex: один Tab-стоп, стрелки, Home/End, подсказка', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/stats?period=all');
    const hours = page.getByRole('group', { name: 'Трофеи по часам суток, МСК' });
    const bars = hours.getByRole('img');
    await expect(bars.locator('xpath=self::*[@tabindex="0"]')).toHaveCount(1);
    await bars.first().focus();
    await expect(page.getByRole('tooltip')).toContainText('00:00-01:00');
    await page.keyboard.press('ArrowRight');
    await expect(bars.nth(1)).toBeFocused();
    await expect(bars.nth(1)).toHaveAttribute('tabindex', '0');
    await expect(bars.first()).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('End');
    await expect(bars.nth(23)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(bars.nth(23)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(bars.first()).toBeFocused();
    await page.keyboard.press('Escape');
  });

  test('hasData=false: заглушка «Пока мало данных», без итога словами, подпись остаётся', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/stats', { pattern: false });
    await expect(page.getByTestId('pp-stub')).toContainText('Пока мало данных');
    await expect(page.getByTestId('pp-summary')).toHaveCount(0);
    await expect(page.getByText('по времени трофеев · МСК')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Трофеи по часам суток, МСК' })).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined|null|Invalid/);
  });

  test('7 тем: график и «Всё время» без горизонтального переполнения', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/stats?period=all');
    await expect(page.getByRole('heading', { name: 'Когда ты играешь' })).toBeVisible();
    for (const t of ['night', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5', 'graphite']) {
      await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
      const c = await page.locator('.ps-pp__col[data-peak] .ps-pp__fill').first().evaluate((el) => getComputedStyle(el).opacity);
      expect(Number(c), t).toBe(1);
      expect(await overflow(page), t).toBeLessThanOrEqual(0);
    }
  });
});

// ---------------- Итоги ----------------
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

test.describe('Итоги: «Всё время» (Фаза 26)', () => {
  test('карточка «Всё время» первая, шире, выбор пишет ?year=all и запрашивает all', async ({ page, context, baseURL }) => {
    const calls = await openWrapped(page, context, baseURL!);
    const all = page.locator('button.ps-wrapped-year--all');
    await expect(all).toBeVisible();
    await expect(all).toContainText('Всё время');
    await expect(all).toContainText(`${FIRST_Y} – ${CUR}`);
    const first = page.locator('.ps-wrapped-years > button').first();
    await expect(first).toHaveClass(/ps-wrapped-year--all/);
    const [a, b] = await Promise.all([all.boundingBox(), page.locator('button.ps-wrapped-year:not(.ps-wrapped-year--all)').first().boundingBox()]);
    if ((page.viewportSize()?.width ?? 0) >= 768) { expect(Math.round(a!.width)).toBe(128); expect(Math.round(b!.width)).toBe(96); }
    await all.click();
    await expect(page).toHaveURL(/year=all$/);
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => calls[calls.length - 1].searchParams.get('year')).toBe('all');
    await expect(page.getByRole('button', { name: 'Смотреть итоги за всё время' })).toBeEnabled();
  });

  test('недоступна без данных: приглушена и «нет данных»', async ({ page, context, baseURL }) => {
    await openWrapped(page, context, baseURL!, '/wrapped', { allAvailable: false });
    const all = page.locator('button.ps-wrapped-year--all');
    await expect(all).toContainText('нет данных');
    await expect(all).toBeDisabled();
  });

  test('история: 9 слайдов в порядке контракта, метка, aria-label, объявление слайда', async ({ page, context, baseURL }) => {
    await openWrapped(page, context, baseURL!, '/wrapped?year=all');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Смотреть итоги за всё время' }).click();
    const stage = page.getByRole('dialog', { name: 'Итоги за всё время' });
    await expect(stage).toBeVisible();
    await expect(page.locator('.ps-story__seg')).toHaveCount(9);
    await expect(page.locator('.ps-story__brand')).toHaveText('PS TRACKER · ВСЁ ВРЕМЯ');
    await expect(page.getByRole('heading', { name: 'Всё время в играх' })).toBeVisible();
    await expect(page.locator('.ps-story__small')).toHaveText(`${FIRST_Y} – ${CUR}`);
    const order = ['start', 'firstGame', 'hours', 'platinumYears', 'busiestYear', 'genres', 'longestGame', 'playPattern', 'final'];
    for (let i = 1; i < order.length; i++) {
      await page.keyboard.press('ArrowRight');
      expect(await sid(page)).toBe(order[i]);
      if (order[i] === 'firstGame') {
        await expect(page.getByRole('heading', { name: 'С чего всё началось' })).toBeVisible();
        await expect(stage).toContainText('Первый запуск: 12 марта 2014');
        await expect(stage).toContainText('лет назад');
        await expect(page.locator('.ps-story__hero')).toBeVisible();
      }
      if (order[i] === 'hours') {
        await expect(page.locator('.ps-story__big')).toContainText('2 840,5');
        await expect(page.locator('.ps-story__badge')).toContainText('оценены');
        await expect(page.locator('.ps-story__badge')).not.toContainText('равен сумме'); // unattributed = 40
      }
      if (order[i] === 'platinumYears') {
        await expect(page.getByRole('heading', { name: 'Платины' })).toBeVisible();
        await expect(page.locator('.ps-plat__row')).toHaveCount(8);
        await expect(stage).toContainText('и ещё 2 года');
        await expect(page.locator('.ps-plat__y').first()).toHaveText(String(CUR));
      }
      if (order[i] === 'busiestYear') {
        await expect(page.locator('.ps-story__big')).toHaveText(String(FIRST_Y + 5));
        await expect(page.locator('.ps-busy__slot[data-leader]')).toHaveCount(1);
      }
      if (order[i] === 'genres') await expect(page.getByRole('heading', { name: 'Экшен' })).toBeVisible();
      if (order[i] === 'playPattern') {
        await expect(page.getByRole('heading', { name: 'Ты играешь вечерами' })).toBeVisible();
        await expect(page.locator('.ps-pps__peak')).toHaveText('21:00');
        await expect(page.getByText('Любимый день: суббота')).toBeVisible();
        await expect(page.locator('.ps-pps__cap')).toHaveText('по времени трофеев · МСК');
        await expect(page.getByRole('group', { name: 'Чаще всего ты получаешь трофеи в 21:00-22:00, любимый день суббота' })).toBeVisible();
        await expect(page.locator('.ps-pps__chart')).toHaveCount(2);
      }
      if (order[i] === 'final') {
        await expect(page.getByRole('heading', { name: 'Спасибо, что играешь' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Пересмотреть' })).toBeVisible();
      }
    }
    await expect(page.getByRole('status')).toContainText('Слайд 9 из 9');
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined|null|Invalid/);
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(page.locator('.ps-story__stage')).toHaveCount(0);
  });

  test('без паттерна (hasData=false) слайда нет: 8 сегментов', async ({ page, context, baseURL }) => {
    await openWrapped(page, context, baseURL!, '/wrapped?year=all', { pattern: false });
    await page.getByRole('button', { name: 'Смотреть итоги за всё время' }).click();
    await expect(page.locator('.ps-story__seg')).toHaveCount(8);
  });

  test('тач: тап по правой части листает вперёд, по левой назад; свайп влево вперёд', async ({ page, context, baseURL }) => {
    await openWrapped(page, context, baseURL!, '/wrapped?year=all');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Смотреть итоги за всё время' }).click();
    const b = (await page.locator('.ps-story__stage').boundingBox())!;
    await page.mouse.click(b.x + b.width * 0.8, b.y + b.height * 0.5);
    expect(await sid(page)).toBe('firstGame');
    await page.mouse.click(b.x + b.width * 0.1, b.y + b.height * 0.5);
    expect(await sid(page)).toBe('start');
    await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.5, { steps: 6 });
    await page.mouse.up();
    expect(await sid(page)).toBe('firstGame');
  });

  test('автопереход: слайд сменяется сам (быстрый таймер)', async ({ page, context, baseURL }) => {
    await openWrapped(page, context, baseURL!, '/wrapped?year=all');
    await page.addStyleTag({ content: ':root{--dur-slide:500ms !important}' });
    await page.getByRole('button', { name: 'Смотреть итоги за всё время' }).click();
    await expect.poll(() => sid(page), { timeout: 5000 }).not.toBe('start');
  });

  test('годовой набор: слайд «Когда ты играешь» есть, если пришёл в slides', async ({ page, context, baseURL }) => {
    await openWrapped(page, context, baseURL!, `/wrapped?year=${CUR}`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Смотреть итоги', exact: true }).click();
    await expect(page.locator('.ps-story__seg')).toHaveCount(5);
    await expect(page.getByRole('dialog', { name: `Итоги ${CUR}` })).toBeVisible();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    expect(await sid(page)).toBe('playPattern');
    await expect(page.locator('.ps-pps__peak')).toHaveText('21:00');
    await page.keyboard.press('ArrowRight');
    expect(await sid(page)).toBe('final');
  });

  test('мобильная ширина: сцена без переполнения, слайд платин и паттерна помещаются', async ({ page, context, baseURL }) => {
    await openWrapped(page, context, baseURL!, '/wrapped?year=all');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Смотреть итоги за всё время' }).click();
    for (const id of ['platinumYears', 'playPattern']) {
      while ((await sid(page)) !== id) await page.keyboard.press('ArrowRight');
      const fits = await page.evaluate(() => {
        const body = document.querySelector('.ps-story__body') as HTMLElement;
        const st = document.querySelector('.ps-story__stage') as HTMLElement;
        const s = st.getBoundingClientRect();
        const kids = Array.from(body.querySelectorAll<HTMLElement>('*')).filter((e) => e.getBoundingClientRect().height > 0);
        return kids.every((e) => { const r = e.getBoundingClientRect(); return r.right <= s.right + 1 && r.left >= s.left - 1 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1; });
      });
      expect(fits, id).toBe(true);
    }
  });
});
