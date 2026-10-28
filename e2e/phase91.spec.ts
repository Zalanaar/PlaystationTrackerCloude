// Фаза 9.1 (UI): «Убрать из этого месяца» (контракт 15.1), окно игры (шапка, плитки, прогноз платины 14.2/15.3), платиновый уголок.
// API эмулируется по контракту, БД не нужна.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed, type G, type Mock } from './collection-mock';
import { signedSession } from './session';

const Y = Number(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 4));
const MONTH = `${Y}-03`;
const SHOTS = process.env.SHOTS_DIR;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'] as const;
const setTheme = (page: Page, t: string) =>
  page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
const isMobile = (name: string) => name === 'mobile';
const SVG = (w: number, h: number, c: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${c}"/></svg>`;
const z = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };

type PItem = { id: number; title: string; real: number; est: number; plat?: boolean };
const ITEMS: PItem[] = [
  { id: 21, title: 'Ghost', real: 0, est: 4 },
  { id: 22, title: 'Hades Two', real: 5, est: 0 },
  { id: 23, title: 'Platinum Game', real: 2, est: 0, plat: true },
  { id: 24, title: 'Single Month', real: 0, est: 3 },
];
const game = (i: PItem) => ({
  id: i.id, title: i.title, coverUrl: null, bannerUrl: null, tint: null, hiddenAt: null, platform: 'PS5', playSeconds: 36000, hours: 10, playCount: 3,
  lastPlayedAt: '2026-03-10T10:00:00.000Z', status: i.plat ? 'completed' : 'playing', completedAt: null, droppedAt: null,
  trophies: i.plat ? { earned: 10, defined: 10, progress: 100, platinumDefined: true, platinumEarned: true, byType: { platinum: { earned: 1, defined: 1 }, gold: { earned: 0, defined: 0 }, silver: { earned: 0, defined: 0 }, bronze: { earned: 9, defined: 9 } } } : null,
  genres: [{ key: 'ACTION', label: 'Экшен' }],
});

type St = { excluded: Set<number>; puts: { id: number; body: Record<string, unknown> }[]; conflictIds: Set<number>; failNext: boolean; dropIds: Set<number> };

async function openStats(page: Page, context: BrowserContext, baseURL: string): Promise<St> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  const st: St = { excluded: new Set(), puts: [], conflictIds: new Set([24]), failNext: false, dropIds: new Set([24]) };
  await page.route(/\/api\/games\/\d+\/month-exclusions$/, async (r) => {
    const id = Number(r.request().url().match(/games\/(\d+)\//)?.[1]);
    const body = r.request().postDataJSON() as Record<string, unknown>;
    st.puts.push({ id, body });
    const out = (status: number, data: unknown) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { ok: true, data } : { ok: false, error: data }) });
    if (st.failNext) { st.failNext = false; return out(503, { code: 'db_unavailable', message: 'x' }); }
    if (body.excluded === true && st.conflictIds.has(id)) {
      return out(409, { code: 'month_exclusion_conflict', message: 'Нельзя убрать игру из всех месяцев: часы некуда перераспределить.', details: { gameId: id, month: MONTH, rangeMonths: [MONTH], excludedMonths: [] } });
    }
    if (body.excluded) st.excluded.add(id); else st.excluded.delete(id);
    const it = ITEMS.find((x) => x.id === id);
    return out(200, {
      gameId: id, month: body.month, excluded: body.excluded, excludedMonths: st.excluded.has(id) ? [MONTH] : [],
      redistributed: body.excluded === true && (it?.est ?? 0) > 0 && !st.dropIds.has(id), estimateDropped: body.excluded === true && (it?.est ?? 0) > 0 && st.dropIds.has(id),
    });
  });
  await page.route(/\/api\/stats\?/, (r) => {
    const u = new URL(r.request().url());
    const year = Number(u.searchParams.get('year') ?? Y);
    const item = (i: PItem) => ({ gameId: i.id, hours: i.real + i.est, hoursReal: i.real, hoursEstimated: i.est, estimated: i.est > 0, finished: i.plat ? 'completed' : null, finishedAt: i.plat ? '2026-03-10T10:00:00.000Z' : null });
    const keep = ITEMS.filter((i) => !st.excluded.has(i.id));
    const out = ITEMS.filter((i) => st.excluded.has(i.id)).map((i) => ({ ...item(i), hours: i.real, hoursEstimated: 0, estimated: false }));
    const body = {
      period: { type: 'year', year, month: null, from: `${year}-01-01`, to: `${year}-12-31`, fromUtc: `${year - 1}-12-31T21:00:00.000Z`, toUtc: `${year}-12-31T21:00:00.000Z` },
      years: [Y], header: { completed: 1, dropped: 0, hours: 20, platinum: 1 },
      hours: { byMonth: Array(12).fill(null), estimatedByMonth: Array(12).fill(0), estimatedHours: 0, hasEstimate: false, firstSnapshotDate: `${Y}-01-15`, periodPartial: false },
      genres: { hasData: false, items: [], games: {} }, top: { byHours: [], byTrophies: [] },
      trophies: { counts: z, byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...z })) },
      finished: { groups: [] }, rareTrophies: { period: [], allTime: [] },
      played: { games: Object.fromEntries(ITEMS.map((i) => [String(i.id), game(i)])), groups: [{ month: MONTH, year, monthNumber: 3, completed: 1, dropped: 0, items: keep.map(item), excluded: out }] },
    };
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: body }) });
  });
  await page.goto('/stats');
  await expect(page.getByRole('heading', { name: 'Игры месяца' })).toBeVisible();
  return st;
}
const cardOf = (page: Page, title: string) => page.locator('.ps-st-played article.ps-card', { has: page.getByRole('button', { name: `Открыть: ${title}`, exact: false }) });
const menuBtn = (page: Page, title: string) => page.getByRole('button', { name: `Действия: ${title}, март` });
const toast = (page: Page) => page.locator('.ps-toast');

test.describe('Фаза 9.1: убрать из этого месяца', () => {
  test('оценочные часы: без диалога, тост с «Отменить», игра пропадает и возвращается', async ({ page, context, baseURL }) => {
    const st = await openStats(page, context, baseURL!);
    st.dropIds.clear();
    await expect(cardOf(page, 'Ghost')).toHaveCount(1);
    await menuBtn(page, 'Ghost').click();
    await expect(page.getByText('Игра останется в коллекции и в других месяцах')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Убрать из этого месяца' }).click();
    expect(st.puts.at(-1)).toMatchObject({ id: 21, body: { month: MONTH, excluded: true } });
    await expect(toast(page)).toContainText('Игра убрана из марта. Оценочные часы перераспределены по другим месяцам');
    await expect(cardOf(page, 'Ghost')).toHaveCount(0);
    const row = page.getByRole('button', { name: 'Убрано из месяца: 1' });
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await toast(page).getByRole('button', { name: 'Отменить' }).click();
    expect(st.puts.at(-1)).toMatchObject({ id: 21, body: { month: MONTH, excluded: false } });
    await expect(cardOf(page, 'Ghost')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Убрано из месяца/ })).toHaveCount(0);
  });

  test('измеренные часы: диалог с часами, «Отмена» ничего не шлёт, подтверждение убирает из списка', async ({ page, context, baseURL }) => {
    const st = await openStats(page, context, baseURL!);
    await menuBtn(page, 'Hades Two').click();
    await page.getByRole('menuitem', { name: 'Убрать из этого месяца' }).click();
    await expect(page.getByText('Убрать из списка марта?')).toBeVisible();
    await expect(page.getByText(/Измеренные часы \(5 ч\) останутся/)).toBeVisible();
    await page.getByRole('button', { name: 'Отмена' }).click();
    expect(st.puts).toHaveLength(0);
    await expect(menuBtn(page, 'Hades Two')).toBeFocused();
    await menuBtn(page, 'Hades Two').click();
    await page.getByRole('menuitem', { name: 'Убрать из этого месяца' }).click();
    await page.getByRole('button', { name: 'Убрать из списка' }).click();
    expect(st.puts).toHaveLength(1);
    await expect(toast(page)).toContainText('Игра убрана из списка марта. Измеренные часы остаются');
    await expect(cardOf(page, 'Hades Two')).toHaveCount(0);
  });

  test('Esc закрывает меню и возвращает фокус на «⋯»', async ({ page, context, baseURL }, info) => {
    test.skip(isMobile(info.project.name), 'на мобильном sheet');
    await openStats(page, context, baseURL!);
    await menuBtn(page, 'Ghost').click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(menuBtn(page, 'Ghost')).toBeFocused();
  });

  test('409: ошибка в тосте, карточка остаётся; выпавшая оценка названа в тосте', async ({ page, context, baseURL }) => {
    const st = await openStats(page, context, baseURL!);
    await menuBtn(page, 'Single Month').click();
    await page.getByRole('menuitem', { name: 'Убрать из этого месяца' }).click();
    await expect(toast(page)).toContainText('Нельзя убрать игру из всех месяцев: часы некуда перераспределить.');
    await expect(cardOf(page, 'Single Month')).toHaveCount(1);
    st.conflictIds.clear();
    await menuBtn(page, 'Single Month').click();
    await page.getByRole('menuitem', { name: 'Убрать из этого месяца' }).click();
    await expect(toast(page).last()).toContainText('выпали из статистики');
  });

  test('сетевая ошибка: тост «Повторить», повтор срабатывает', async ({ page, context, baseURL }) => {
    const st = await openStats(page, context, baseURL!);
    st.dropIds.clear();
    st.failNext = true;
    await menuBtn(page, 'Ghost').click();
    await page.getByRole('menuitem', { name: 'Убрать из этого месяца' }).click();
    await expect(toast(page)).toContainText('Не удалось убрать игру. Повтори');
    await expect(cardOf(page, 'Ghost')).toHaveCount(1);
    await toast(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(cardOf(page, 'Ghost')).toHaveCount(0);
  });

  test('убранные: свёрнутая строка раскрывается, «Вернуть в месяц» без диалога', async ({ page, context, baseURL }) => {
    const st = await openStats(page, context, baseURL!);
    st.dropIds.clear();
    st.excluded.add(21);
    await page.reload();
    const row = page.getByRole('button', { name: 'Убрано из месяца: 1' });
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    const ex = cardOf(page, 'Ghost');
    await expect(ex).toHaveAttribute('data-excluded', 'true');
    await expect(ex.getByText('Убрана')).toBeVisible();
    await expect(page.getByText(/Измеренные часы этих игр остаются/)).toBeVisible();
    await menuBtn(page, 'Ghost').click();
    await page.getByRole('menuitem', { name: 'Вернуть в месяц' }).click();
    expect(st.puts.at(-1)).toMatchObject({ id: 21, body: { excluded: false } });
    await expect(toast(page)).toContainText('Игра возвращена в март');
  });

  test('скриншоты «Игр месяца» во всех темах', async ({ page, context, baseURL }, info) => {
    test.skip(!SHOTS, 'нужен SHOTS_DIR');
    const st = await openStats(page, context, baseURL!);
    st.excluded.add(21);
    await page.reload();
    await page.getByRole('button', { name: /Убрано из месяца/ }).click();
    const sec = page.locator('.ps-st-played');
    await sec.scrollIntoViewIfNeeded();
    await menuBtn(page, 'Hades Two').hover();
    for (const t of THEMES) {
      await setTheme(page, t);
      await page.waitForTimeout(250);
      await sec.screenshot({ path: `${SHOTS}/month-${info.project.name}-${t}.png` });
    }
  });

  test('«⋯» только в «Играх месяца»: в Коллекции его нет', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    await mockApi(page);
    await page.goto('/?sort=last_played');
    await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
    await expect(page.locator('.ps-mm')).toHaveCount(0);
  });
});

test.describe('Фаза 9.1: платиновый уголок', () => {
  test('в «Играх месяца»: уголок слева сверху, подложка, «⋯» справа внизу не пересекается', async ({ page, context, baseURL }) => {
    await openStats(page, context, baseURL!);
    const c = cardOf(page, 'Platinum Game');
    await expect(c).toHaveAttribute('data-platinum', 'true');
    const corner = c.locator('.ps-card__plat');
    await expect(corner).toHaveAttribute('role', 'img');
    await expect(corner).toHaveAttribute('aria-label', 'Платина получена');
    const [cv, cb, g, m] = await Promise.all([c.locator('.ps-card__cover').boundingBox(), corner.boundingBox(), c.locator('.ps-card__glyph').boundingBox(), menuBtn(page, 'Platinum Game').boundingBox()]);
    expect(Math.abs(cb!.x - cv!.x)).toBeLessThan(1.5);
    expect(Math.abs(cb!.y - cv!.y)).toBeLessThan(1.5);
    expect(Math.round(cb!.width)).toBe(30); // плотная сетка
    expect(cb!.x + cb!.width).toBeLessThanOrEqual(g!.x + 1);
    expect(m!.y).toBeGreaterThan(cb!.y + cb!.height);
    const wash = await c.evaluate((el) => getComputedStyle(el, '::before').backgroundImage);
    expect(wash).toContain('linear-gradient');
    expect(await c.locator('.ps-card__plat-in').evaluate((el) => getComputedStyle(el).clipPath)).toContain('polygon');
  });

  test('в Коллекции: уголок 44 (моб. 38), круглого бейджа нет', async ({ page, context, baseURL }, info) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    await mockApi(page);
    await page.goto('/?sort=last_played&status=completed');
    const corner = page.locator('article.ps-card[data-platinum="true"] .ps-card__plat').first();
    await expect(corner).toBeVisible();
    const b = await corner.boundingBox();
    expect(Math.round(b!.width)).toBe(isMobile(info.project.name) ? 38 : 44);
    expect(await corner.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('0px');
  });
});

test.describe('Фаза 9.1: окно игры', () => {
  const FORECAST = {
    setId: 1, required: 54, earned: 49, progress: 91, remaining: { gold: 1, silver: 1, bronze: 3, total: 5 }, remainingHidden: 1,
    avgEarnedRate: 12.4, minEarnedRate: 1.2, ratesKnown: 4, platinumEarnedRate: 4.3, approximate: true, dlc: { required: 12, earned: 5, remaining: 7 },
  };
  async function openGame(page: Page, context: BrowserContext, baseURL: string, games: G[], setup?: (m: Mock) => void) {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
    await page.route('https://img.test/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: r.request().url().includes('banner') ? SVG(1600, 900, '#445') : SVG(300, 400, '#654') }));
    const m = await mockApi(page, games);
    setup?.(m);
    await page.goto('/?sort=last_played');
    return m;
  }
  const open = async (page: Page, title: string) => {
    await page.locator('article.ps-card', { has: page.locator('.ps-card__title', { hasText: new RegExp(`^${title}$`) }) }).locator('.ps-card__hit').click();
    const dlg = page.getByRole('dialog', { name: title });
    await expect(dlg).toBeVisible();
    return dlg;
  };
  const base = (): G[] => seed().map((g) => (g.id === 3 ? { ...g, bannerUrl: 'https://img.test/banner.svg', coverUrl: 'https://img.test/cover.svg' } : g.id === 4 ? { ...g, coverUrl: 'https://img.test/cover.svg' } : g));

  test('баннер: высота арта 208 (176), обложка выступает за арт, название на арте белым', async ({ page, context, baseURL }, info) => {
    await openGame(page, context, baseURL!, base());
    const dlg = await open(page, 'Horizon Forbidden West');
    await expect(dlg.locator('.ps-gd__hero')).toHaveAttribute('data-art', 'banner');
    const [art, cover] = await Promise.all([dlg.locator('.ps-gd__art').boundingBox(), dlg.locator('.ps-gd__cover').boundingBox()]);
    const m = isMobile(info.project.name);
    expect(Math.round(art!.height)).toBe(m ? 176 : 208);
    expect(Math.round(cover!.y + cover!.height - (art!.y + art!.height))).toBe(m ? 24 : 32);
    const color = await dlg.locator('.ps-gd__title').evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe('rgb(255, 255, 255)');
    const [tt, ca] = await Promise.all([dlg.locator('.ps-gd__tt').boundingBox(), dlg.locator('.ps-gd__art').boundingBox()]);
    expect(tt!.y).toBeGreaterThanOrEqual(ca!.y + 40 - 1);
    expect(tt!.y + tt!.height).toBeLessThanOrEqual(ca!.y + ca!.height + 1);
  });

  test('нет баннера, есть обложка: компактная размытая лента; нет ничего: компактная заливка', async ({ page, context, baseURL }, info) => {
    await openGame(page, context, baseURL!, base());
    const m = isMobile(info.project.name);
    let dlg = await open(page, 'God of War');
    await expect(dlg.locator('.ps-gd__hero')).toHaveAttribute('data-art', 'blur');
    expect(Math.round((await dlg.locator('.ps-gd__art').boundingBox())!.height)).toBe(m ? 120 : 144);
    await page.keyboard.press('Escape');
    dlg = await open(page, 'Stray');
    await expect(dlg.locator('.ps-gd__hero')).toHaveAttribute('data-art', 'none');
    expect(Math.round((await dlg.locator('.ps-gd__art').boundingBox())!.height)).toBe(m ? 120 : 144);
  });

  test('баннер не загрузился: падение на размытую обложку', async ({ page, context, baseURL }) => {
    await openGame(page, context, baseURL!, base().map((g) => (g.id === 3 ? { ...g, bannerUrl: 'https://img.test/missing-banner.png' } : g)));
    await page.route('https://img.test/missing-banner.png', (r) => r.fulfill({ status: 404, body: '' }));
    const dlg = await open(page, 'Horizon Forbidden West');
    await expect(dlg.locator('.ps-gd__hero')).toHaveAttribute('data-art', 'blur');
  });

  test('плитки: значения не переносятся, «Да/Нет» у платины, запуски числом', async ({ page, context, baseURL }) => {
    await openGame(page, context, baseURL!, base());
    let dlg = await open(page, 'Horizon Forbidden West');
    const tiles = dlg.locator('.ps-gd__tile');
    await expect(tiles.nth(1)).toContainText('19');
    await expect(tiles.nth(1)).toContainText('посл. ');
    await expect(tiles.nth(1)).not.toContainText('запусков');
    await expect(tiles.nth(3).locator('.ps-gd__tv')).toHaveText('Нет');
    for (const i of [0, 1, 2, 3]) {
      const v = tiles.nth(i).locator('.ps-gd__tv');
      expect(await v.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await v.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(29);
    }
    const hs = await tiles.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(new Set(hs).size).toBe(1);
    await page.keyboard.press('Escape');
    dlg = await open(page, 'The Witcher 3: Wild Hunt');
    await expect(dlg.locator('.ps-gd__tile[data-tile="platinum"]')).toHaveAttribute('aria-label', 'Платина: получена 5 окт. 2026');
    await expect(dlg.locator('.ps-gd__tile[data-tile="platinum"] .ps-gd__tv')).toHaveText('Да');
  });

  test('«Обзор»: секции-карточки, лист по содержимому на десктопе', async ({ page, context, baseURL }, info) => {
    await openGame(page, context, baseURL!, base());
    const dlg = await open(page, 'Horizon Forbidden West');
    await expect(dlg.getByRole('heading', { name: 'Статус и даты' })).toBeVisible();
    await expect(dlg.getByRole('heading', { name: 'Запуски' })).toBeVisible();
    await expect(dlg.getByText('Игра не будет показываться нигде, синк её не вернёт.')).toBeVisible();
    await expect(dlg.getByText(/25 окт\. 2026 · /).or(dlg.getByText(/20 окт\. 2026 · /))).toBeVisible();
    const col = dlg.locator('.ps-gd__col');
    if (isMobile(info.project.name)) expect(Math.round((await col.boundingBox())!.height)).toBeGreaterThanOrEqual(page.viewportSize()!.height - 1);
    else {
      // лист «парит»: высота по содержимому, не растянут на экран
      expect(await col.evaluate((el) => getComputedStyle(el).minHeight)).toBe('0px');
      expect(await col.evaluate((el) => getComputedStyle(el).borderBottomLeftRadius)).not.toBe('0px');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  test('прогноз платины: «≈», сноска про DLC, DLC отдельно, склонение, скрытые', async ({ page, context, baseURL }) => {
    await openGame(page, context, baseURL!, base(), (m) => { m.forecasts[3] = FORECAST; });
    const dlg = await open(page, 'Horizon Forbidden West');
    const sec = dlg.getByRole('region', { name: 'Путь к платине' });
    await expect(sec).toBeVisible();
    await expect(sec.getByLabel('Прогресс к платине: 91%')).toContainText('≈');
    await expect(sec.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '91');
    await expect(sec).toContainText('49 из 54 трофеев (кроме платины)');
    await expect(sec).toContainText('5 трофеев');
    await expect(sec.getByLabel('Золото: 1')).toBeVisible();
    await expect(sec.getByLabel('Бронза: 3')).toBeVisible();
    await expect(sec).toContainText('из них скрытых: 1');
    await expect(sec).toContainText('12,4%');
    await expect(sec).toContainText('Процент известен у 4 из 5 оставшихся');
    await expect(sec).toContainText('Приблизительно: считаем все трофеи набора, включая DLC.');
    await expect(sec).toContainText('получено 5 из 12, осталось 7');
  });

  test('прогноз без approximate: без «≈» и сноски; остался один трофей', async ({ page, context, baseURL }) => {
    await openGame(page, context, baseURL!, base(), (m) => {
      m.forecasts[3] = { ...FORECAST, approximate: false, dlc: null, remaining: { gold: 0, silver: 0, bronze: 1, total: 1 }, ratesKnown: 1 };
    });
    const dlg = await open(page, 'Horizon Forbidden West');
    const sec = dlg.getByRole('region', { name: 'Путь к платине' });
    await expect(sec).toContainText('остался 1 трофей');
    await expect(sec).toContainText('Почти готово');
    await expect(sec).not.toContainText('≈');
    await expect(sec).not.toContainText('Приблизительно');
  });

  test('скриншоты окна игры во всех темах', async ({ page, context, baseURL }, info) => {
    test.skip(!SHOTS, 'нужен SHOTS_DIR');
    await openGame(page, context, baseURL!, base(), (m) => { m.forecasts[3] = FORECAST; });
    for (const [title, tag] of [['Horizon Forbidden West', 'banner'], ['God of War', 'blur'], ['The Witcher 3: Wild Hunt', 'plat']] as const) {
      const dlg = await open(page, title);
      await page.waitForTimeout(500);
      for (const t of THEMES) {
        await setTheme(page, t);
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${SHOTS}/dialog-${tag}-${info.project.name}-${t}.png`, fullPage: false });
        if (tag === 'banner') await dlg.locator('.ps-gd__fc').screenshot({ path: `${SHOTS}/forecast-${info.project.name}-${t}.png` });
      }
      await setTheme(page, 'night');
      await dlg.press('Escape');
    }
  });

  test('нет прогноза: секции нет; ошибка деталей не роняет окно', async ({ page, context, baseURL }) => {
    await openGame(page, context, baseURL!, base());
    let dlg = await open(page, 'Horizon Forbidden West');
    await expect(dlg.getByRole('heading', { name: 'Запуски' })).toBeVisible();
    await expect(dlg.getByRole('region', { name: 'Путь к платине' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.route(/\/api\/games\/\d+(\?|$)/, (r) => (r.request().method() === 'GET'
      ? r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'db_unavailable', message: 'x' } }) })
      : r.fallback()));
    dlg = await open(page, 'Horizon Forbidden West');
    await expect(dlg.locator('.ps-gd__tile')).toHaveCount(4);
    await expect(dlg.getByRole('region', { name: 'Путь к платине' })).toHaveCount(0);
  });
});
