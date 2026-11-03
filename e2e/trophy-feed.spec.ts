// F3 «Лента трофеев» (пакет 3): вход из чипа «+N трофеев», из меню и из Статистики; фильтры периода и «Только редкие»,
// группы дней МСК, «Показать ещё», тап → окно игры на вкладке «Трофеи»; без сдвигов макета (CLS 0, iPhone — позиции).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

const DAY = 86_400_000;
const MSK = 3 * 3600_000;
const mskDay = (t: number) => new Date(t + MSK).toISOString().slice(0, 10);
type Row = { id: number; type: 'platinum' | 'gold' | 'silver' | 'bronze'; at: number | null; rate: number; rarity: number; gameId: number | null };

/** 70 трофеев: 11 за 7 дней (часть сегодня/вчера), остальные дальше; 2 без даты; редких (<5 %) — каждый седьмой. */
function rows(now: number): Row[] {
  const out: Row[] = [];
  const types = ['bronze', 'bronze', 'silver', 'bronze', 'gold', 'bronze', 'silver'] as const;
  const today0 = Math.floor((now + MSK) / DAY) * DAY - MSK; // полночь МСК сегодня (UTC)
  for (let i = 0; i < 68; i++) {
    // 0–2 сегодня, 3–5 вчера, 6–10 позавчера…6 дней назад, дальше от 8 дней
    const at = i < 3 ? Math.max(today0 + 60_000 * (i + 1), now - 60_000 * (i + 1)) : i < 6 ? today0 - 3600_000 * (i - 1) : i < 11 ? today0 - DAY * (i - 5) - 3600_000 : now - (8 + i) * DAY;
    out.push({ id: 1000 - i, type: i === 0 ? 'platinum' : types[i % 7], at, rate: i % 7 === 0 ? 2.5 : 20 + i, rarity: i % 7 === 0 ? 0 : 2, gameId: i % 5 === 4 ? null : 3 });
  }
  out.push({ id: 10, type: 'bronze', at: null, rate: 40, rarity: 3, gameId: 3 }, { id: 9, type: 'bronze', at: null, rate: 41, rarity: 3, gameId: 3 });
  return out;
}

async function mockFeed(page: Page, delay = 0) {
  const now = Date.now();
  const all = rows(now);
  const calls: URL[] = [];
  await page.route(/\/api\/trophies\/feed(\?|$)/, async (r) => {
    const u = new URL(r.request().url());
    calls.push(u);
    if (delay) await new Promise((ok) => setTimeout(ok, delay));
    const period = u.searchParams.get('period') ?? '7d';
    const rare = u.searchParams.get('rare') === '1';
    const since = period === '7d' ? now - 7 * DAY : period === 'month' ? now - 30 * DAY : null;
    let list = all.filter((x) => (since === null || (x.at !== null && x.at > since)) && (!rare || x.rate < 5));
    const summary = { total: list.length, platinum: 0, gold: 0, silver: 0, bronze: 0 };
    for (const x of list) summary[x.type]++;
    const c = u.searchParams.get('cursor');
    if (c) list = list.slice(list.findIndex((x) => String(x.id) === c.split('_')[1]) + 1);
    const page1 = list.slice(0, 50);
    const items = page1.map((x) => ({
      id: x.id, setId: 1, trophyId: x.id, type: x.type, name: `Трофей ${x.id}`, detail: null, iconUrl: null,
      earnedAt: x.at === null ? null : new Date(x.at).toISOString(), day: x.at === null ? null : mskDay(x.at), earnedRate: x.rate, rarity: x.rarity, setName: 'Набор',
      game: x.gameId === null ? null : { id: x.gameId, title: 'Игра три' },
    }));
    const last = page1[page1.length - 1];
    const nextCursor = list.length > 50 && last ? `${last.at ?? 'n'}_${last.id}` : null;
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { period, rare, today: mskDay(now), summary, items, nextCursor } }) });
  });
  return { calls, all, now };
}

async function setup(page: Page, context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const m = await mockApi(page, seed());
  m.inbox = { trophies: 11, platinums: 1, trophiesWindow: '7d', isEmpty: false };
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
  return m;
}
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

test('чип «+N трофеев» ведёт в ленту: сводка, группы дней, строки', async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!);
  const f = await mockFeed(page);
  await page.goto('/');
  const chip = page.getByTestId('inbox-trophies');
  await expect(chip).toHaveAttribute('href', '/trophies?period=7d');
  await chip.click();
  await expect(page).toHaveURL(/\/trophies\?period=7d$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Трофеи' })).toBeVisible();
  const n7 = f.all.filter((x) => x.at !== null && x.at > f.now - 7 * DAY).length;
  await expect(page.getByTestId('tfeed-summary')).toContainText(`За 7 дней: +${n7}`);
  await expect(page.getByTestId('tfeed-row')).toHaveCount(n7);
  await expect(page.getByRole('heading', { level: 2, name: 'Сегодня' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Вчера' })).toBeVisible();
  // вкладка «Статистика» подсвечена (лента — часть раздела)
  if (!isMobile(page)) await expect(page.locator('.ps-nav-item[aria-current="page"]')).toHaveText('Статистика');
  else await expect(page.locator('.ps-tab[aria-current="page"]')).toContainText('Статистика');
});

test('фильтры: Месяц, Все, «Только редкие» (<5 %); URL запоминает выбор; «Показать ещё» без дублей', async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!);
  const f = await mockFeed(page);
  await page.goto('/trophies');
  await expect(page.getByTestId('tfeed-row').first()).toBeVisible();
  await page.getByRole('button', { name: 'Все', exact: true }).click();
  await expect(page).toHaveURL(/\/trophies\?period=all$/);
  await expect(page.getByTestId('tfeed-summary')).toContainText(`За всё время: +${f.all.length}`);
  await expect(page.getByTestId('tfeed-row')).toHaveCount(50);
  await page.getByTestId('tfeed-more').click();
  await expect(page.getByTestId('tfeed-row')).toHaveCount(f.all.length);
  await expect(page.getByTestId('tfeed-more')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'Без даты' })).toBeVisible();
  await page.getByTestId('tfeed-rare').click();
  await expect(page).toHaveURL(/\/trophies\?period=all&rare=1$/);
  const rare = f.all.filter((x) => x.rate < 5).length;
  await expect(page.getByTestId('tfeed-row')).toHaveCount(rare);
  await expect(page.getByTestId('tfeed-rare')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Месяц', exact: true }).click();
  await expect(page).toHaveURL(/\/trophies\?period=month&rare=1$/);
  expect(f.calls.at(-1)?.search).toBe('?period=month&rare=1');
  // перезагрузка: выбор из URL
  await page.reload();
  await expect(page.getByRole('button', { name: 'Месяц', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tfeed-rare')).toHaveAttribute('aria-pressed', 'true');
});

test('тап по строке открывает окно игры на вкладке «Трофеи»; строка без игры не ссылка', async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!);
  await mockFeed(page);
  await page.goto('/trophies?period=all');
  const rowsL = page.getByTestId('tfeed-row');
  await expect(rowsL.first()).toBeVisible();
  await expect(rowsL.nth(4).locator('a')).toHaveCount(0);
  await expect(rowsL.nth(4)).toContainText('Набор · ');
  await rowsL.first().locator('a').click();
  await expect(page).toHaveURL(/\/\?game=3&tab=trophies$/);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('пункт меню «Лента трофеев» и ссылка из Статистики', async ({ page, context, baseURL }) => {
  await setup(page, context, baseURL!);
  await mockFeed(page);
  await page.goto('/');
  if (isMobile(page)) {
    await page.getByRole('button', { name: 'Меню' }).click();
    await page.getByTestId('more-menu-trophies').click();
  } else {
    await page.locator('.ps-avatar').click();
    await page.getByTestId('menu-trophies').click();
  }
  await expect(page).toHaveURL(/\/trophies$/);
  await expect(page.getByTestId('tfeed-row').first()).toBeVisible();
});

test('без сдвигов: данные приходят позже, шапка и чипы на месте', async ({ page, context, baseURL }, info) => {
  await setup(page, context, baseURL!);
  await mockFeed(page, 1200);
  const chromium = info.project.name !== 'webkit-iphone';
  if (chromium) {
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) w.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    });
  }
  await page.goto('/trophies');
  const chips = page.getByRole('group', { name: 'Период и редкость' });
  await chips.waitFor();
  const before = (await chips.boundingBox())!;
  await expect(page.getByTestId('tfeed-row').first()).toBeVisible();
  const after = (await chips.boundingBox())!;
  expect(Math.abs(after.y - before.y)).toBeLessThan(0.5);
  if (chromium) expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.01);
  const noH = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(noH).toBe(true);
});
