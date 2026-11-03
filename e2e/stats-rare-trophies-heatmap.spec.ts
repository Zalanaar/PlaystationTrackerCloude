// Фаза 15: редкие трофеи, карта активности, «Ближе всего к платине», забытые игры, слайд редких трофеев в Итогах.
// Ответы эмулируются по контрактам 14.1-14.4 (e2e/collection-mock.ts); форма ответов новых полей не повторяет реализацию.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed, type G, type Mock } from './collection-mock';
import { signedSession } from './session';
import { enterSelect } from './view';

const SHOTS = process.env.SHOTS_DIR;
const nowMsk = new Date(Date.now() + 3 * 3600_000);
const THIS_YEAR = nowMsk.getUTCFullYear();
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const z = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };

const short = (id: number, title: string) => ({ id, title, coverUrl: null });
const rare = (trophyId: number, o: Record<string, unknown> = {}) => ({
  setId: 1, trophyId, type: 'gold', name: `Редкий ${trophyId}`, detail: 'Описание', iconUrl: null, earnedAt: `${THIS_YEAR}-03-02T19:10:00.000Z`,
  earnedRate: 0.8 + trophyId, rarity: 0, setName: 'Horizon', game: short(17, 'Horizon Forbidden West'), ...o,
});
const RARE_PERIOD = [
  rare(0, { name: 'Без единой царапины', earnedRate: 0.8 }),
  rare(1, { type: 'platinum', name: 'Легенда', earnedRate: 2.4, rarity: 0 }),
  rare(2, { type: 'silver', name: 'Мастер охоты', earnedRate: 3.9, rarity: 1, game: short(18, 'Ghost of Tsushima') }),
  rare(3, { type: 'bronze', name: 'Сирота', earnedRate: 4.6, rarity: 1, game: null, setName: 'Старая игра' }),
  rare(4, { name: 'Неизвестная редкость', earnedRate: 7.1, rarity: null, earnedAt: null }),
];
const RARE_ALL = [rare(9, { name: 'Всё время ' + 1, earnedRate: 0.1 }), rare(10, { name: 'Всё время 2', earnedRate: 0.3 })];

function statsRespond(u: URL, rareTrophies: unknown) {
  const type = u.searchParams.get('period') === 'month' ? 'month' : 'year';
  const year = Number(u.searchParams.get('year') ?? THIS_YEAR);
  const g = { id: 1, title: 'Игра Один', coverUrl: null, platform: 'PS5', playSeconds: 36000, hours: 10, playCount: 3, lastPlayedAt: `${THIS_YEAR}-03-10T10:00:00.000Z`, status: 'completed', completedAt: `${THIS_YEAR}-03-10T10:00:00.000Z`, droppedAt: null, trophies: null, genres: [{ key: 'ACTION', label: 'Экшен' }] };
  return {
    period: { type, year, month: null, from: `${year}-01-01`, to: `${year}-12-31`, fromUtc: `${year - 1}-12-31T21:00:00.000Z`, toUtc: `${year}-12-31T21:00:00.000Z` },
    years: [THIS_YEAR, THIS_YEAR - 1],
    header: { completed: 1, dropped: 0, hours: 50, platinum: 1 },
    hours: { byMonth: Array(12).fill(null).map((_, i) => (i < 3 ? 10 : null)), estimatedByMonth: Array(12).fill(0), estimatedHours: 0, hasEstimate: false, firstSnapshotDate: `${THIS_YEAR}-01-15`, periodPartial: false },
    genres: { hasData: true, items: [{ key: 'ACTION', label: 'Экшен', value: 3, gameIds: [1] }], games: { 1: { id: 1, title: 'Игра Один', coverUrl: null } } },
    top: { byHours: [{ game: g, hours: 12.5, estimated: false }], byTrophies: [] },
    ...(rareTrophies === undefined ? {} : { rareTrophies }),
    trophies: { counts: { platinum: 1, gold: 1, silver: 1, bronze: 1, total: 4 }, byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...z })) },
    finished: { groups: [] },
    played: { games: { [String(g.id)]: g }, groups: [{ month: `${year}-03`, year, monthNumber: 3, completed: 1, dropped: 0, items: [{ gameId: g.id, hours: 12.5, estimated: false, finished: 'completed', finishedAt: `${THIS_YEAR}-03-10T10:00:00.000Z` }] }] },
  };
}

async function setup(page: Page, context: BrowserContext, baseURL: string, o: { rare?: unknown; games?: G[] } = {}): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, o.games);
  await page.route(/\/api\/stats\?/, (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: statsRespond(new URL(r.request().url()), o.rare) }),
  }));
  return mock;
}
const setTheme = (page: Page, t: string) => page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test.describe('Редкие трофеи (Статистика)', () => {
  test('топ-5: процент с запятой, редкость, сирота без кнопки, переключатель области', async ({ page, context, baseURL }) => {
    // игра 17 должна быть в каталоге мока: иначе переход на /?game=17 (Фаза 18) даёт 404 и окно сразу закрывается
    const horizon: G = { id: 17, title: 'Horizon Forbidden West', lastPlayedAt: '2026-10-20T18:00:00.000Z', status: 'playing', completedAt: null, droppedAt: null, playSeconds: 101853, playCount: 19 };
    await setup(page, context, baseURL!, { rare: { period: RARE_PERIOD, allTime: RARE_ALL }, games: [...seed(), horizon] });
    await page.goto('/stats');
    const panel = page.getByRole('region', { name: 'Редкие трофеи' });
    await expect(panel).toBeVisible();
    await expect(panel.locator('.ps-rare__row')).toHaveCount(5);
    const first = panel.locator('.ps-rare__row').first();
    await expect(first).toContainText('Без единой царапины');
    await expect(first).toContainText('0,8%');
    await expect(first).toContainText('Ультра-редкий');
    await expect(first).toContainText('Horizon Forbidden West');
    await expect(first).toContainText('2 мар.');
    await expect(panel.locator('.ps-rare__row').nth(4)).toContainText('дата неизвестна');
    await expect(panel.locator('.ps-rare__row').nth(4)).toContainText('Редкость неизвестна');
    // сирота: название набора, строка не кнопка
    const orphan = panel.locator('.ps-rare__row').nth(3);
    await expect(orphan).toContainText('Старая игра');
    await expect(orphan.getByRole('button')).toHaveCount(0);
    // переключатель: подпись периода = год страницы
    const seg = panel.getByRole('group', { name: 'Область' });
    await expect(seg.getByRole('button', { name: String(THIS_YEAR) })).toHaveAttribute('aria-pressed', 'true');
    await seg.getByRole('button', { name: 'За всё время' }).click();
    await expect(panel.locator('.ps-rare__row')).toHaveCount(2);
    await expect(panel).toContainText('Всё время 2');
    // клик по строке открывает окно игры
    await seg.getByRole('button', { name: String(THIS_YEAR) }).click();
    await panel.locator('.ps-rare__row').first().getByRole('button').click();
    await expect(page).toHaveURL(/\/\?game=17&tab=trophies$/);
    await expect(page.getByRole('dialog', { name: 'Horizon Forbidden West' })).toBeVisible();
    await page.waitForTimeout(1500); // окно не должно закрыться само (404)
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('пустые периоды, старый ответ без блока', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!, { rare: { period: [], allTime: [] } });
    await page.goto('/stats');
    const panel = page.getByRole('region', { name: 'Редкие трофеи' });
    await expect(panel.getByText('Редких трофеев за этот период нет')).toBeVisible();
    await panel.getByRole('button', { name: 'За всё время' }).click();
    await expect(panel.getByText('Трофеев с известной редкостью пока нет')).toBeVisible();
    // старый ответ: блока нет, страница работает
    await page.unroute(/\/api\/stats\?/);
    await page.route(/\/api\/stats\?/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: statsRespond(new URL(r.request().url()), undefined) }) }));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Часы по месяцам' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Редкие трофеи' })).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined|Invalid/);
  });

  test('мобильный: нет горизонтального скролла', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'mobile', 'мобильный сценарий');
    await setup(page, context, baseURL!, { rare: { period: RARE_PERIOD, allTime: RARE_ALL } });
    await page.goto('/stats');
    await expect(page.getByRole('region', { name: 'Редкие трофеи' })).toBeVisible();
    await noOverflow(page);
  });
});

test.describe('Карта активности (Статистика)', () => {
  test('ленивая загрузка, раскладка недель, неизвестные дни штриховкой, подсказка, плитки стрика', async ({ page, context, baseURL }) => {
    const mock = await setup(page, context, baseURL!);
    await page.goto('/stats');
    const panel = page.getByRole('region', { name: 'Активность' });
    await panel.scrollIntoViewIfNeeded(); // Фаза 18: страница короче/выше, панель может быть дальше зоны подгрузки
    await expect(panel).toBeVisible();
    const grid = panel.getByRole('grid');
    await expect(grid).toBeVisible();
    expect(mock.activityCalls).toHaveLength(1);
    expect(mock.activityCalls[0].searchParams.get('year')).toBe(String(THIS_YEAR));
    const days = THIS_YEAR % 4 === 0 ? 366 : 365;
    await expect(grid.getByRole('gridcell')).toHaveCount(days);
    // 1 января лежит в первой колонке в строке своего дня недели; до него пустые клетки не рисуются (скрыты)
    const jan1 = grid.getByRole('gridcell', { name: /, 1 января \d{4}:/ });
    await expect(jan1).toHaveAttribute('aria-label', /1 января/);
    // неизвестные дни: штриховка, а не заливка нуля
    const unknown = grid.locator('[data-l="u"]').first();
    expect(await unknown.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('repeating-linear-gradient');
    expect(await grid.locator('[data-l="0"]').first().evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
    // пороги: все уровни присутствуют в узоре мока
    for (const l of ['0', '1', '2', '3', '4']) await expect(grid.locator(`[data-l="${l}"]`).first()).toBeAttached();
    // сегодня отмечено
    await expect(grid.locator('[data-today]')).toHaveCount(1);
    // подсказка по фокусу
    await unknown.focus();
    await expect(page.getByRole('tooltip')).toContainText('Нет данных');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    // плитки стрика, пропуски в лучшей серии
    await expect(panel.locator('.ps-streak__t')).toHaveCount(3);
    await expect(panel.locator('.ps-streak__t[data-id="current"]')).toContainText('2 дня');
    const best = panel.locator('.ps-streak__t[data-id="best"]');
    await expect(best).toContainText('4 дня');
    await expect(best).toContainText('есть дни без данных');
    await expect(best.getByRole('button', { name: /дни без данных/ })).toBeVisible();
    // легенда и сноска про неизвестные дни
    await expect(panel).toContainText('(первый синк) неизвестны');
    await expect(panel.getByLabel('Обозначения карты')).toContainText('Нет данных');
  });

  test('клавиатура: один tab-stop, стрелки двигают по дням и неделям', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'desktop', 'клавиатура');
    await setup(page, context, baseURL!);
    await page.goto('/stats');
    // D-P5: липкая полоса разделов сдвинула панель ниже зоны подгрузки
    await page.getByRole('region', { name: 'Активность' }).scrollIntoViewIfNeeded();
    const cells = page.getByRole('region', { name: 'Активность' }).getByRole('gridcell');
    await expect(cells.first()).toBeVisible();
    await expect(page.locator('.ps-heat__c[tabindex="0"]')).toHaveCount(1);
    const stop = page.locator('.ps-heat__c[tabindex="0"]');
    await stop.focus();
    const label = async () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
    const a = await label();
    await page.keyboard.press('ArrowUp');
    const b = await label();
    expect(b).not.toBe(a);
    await page.keyboard.press('ArrowLeft');
    const c = await label();
    expect(c).not.toBe(b);
    await page.keyboard.press('Home');
    expect(await label()).toMatch(/^Пн,/);
    await page.keyboard.press('End');
    expect(await label()).toMatch(/^Вс,/);
  });

  test('выбор года: запрос с годом, границы по году первого снимка', async ({ page, context, baseURL }) => {
    const mock = await setup(page, context, baseURL!);
    mock.activityFirst = `${THIS_YEAR - 1}-06-01`;
    await page.goto('/stats');
    const panel = page.getByRole('region', { name: 'Активность' });
    await panel.scrollIntoViewIfNeeded(); // Фаза 18: страница короче/выше, панель может быть дальше зоны подгрузки
    const nav = panel.getByRole('group', { name: 'Год активности' });
    await expect(nav).toContainText(String(THIS_YEAR));
    await expect(nav.getByRole('button', { name: 'Следующий год' })).toBeDisabled();
    await nav.getByRole('button', { name: 'Предыдущий год' }).click();
    await expect(nav).toContainText(String(THIS_YEAR - 1));
    await expect.poll(() => mock.activityCalls.at(-1)?.searchParams.get('year')).toBe(String(THIS_YEAR - 1));
    await expect(panel.getByRole('grid')).toHaveAttribute('aria-label', `Активность по дням, ${THIS_YEAR - 1}`);
    // до первого снимка штриховка, после известные дни
    await expect(panel.locator('.ps-heat__c[data-l="u"]').first()).toBeAttached();
    await expect(panel.locator('.ps-heat__c[data-l="4"]').first()).toBeAttached();
    // год первого снимка = минимум
    await expect(nav.getByRole('button', { name: 'Предыдущий год' })).toBeDisabled();
    await nav.getByRole('button', { name: 'Следующий год' }).click();
    await expect(nav).toContainText(String(THIS_YEAR));
  });

  test('состояния: нет снимков, ошибка с повтором, загрузка', async ({ page, context, baseURL }) => {
    const mock = await setup(page, context, baseURL!);
    mock.activityEmpty = true;
    await page.goto('/stats');
    const panel = page.getByRole('region', { name: 'Активность' });
    await panel.scrollIntoViewIfNeeded(); // Фаза 18: страница короче/выше, панель может быть дальше зоны подгрузки
    await expect(panel.getByRole('heading', { name: 'Пока нет данных об активности' })).toBeVisible();
    await expect(panel.getByRole('group', { name: 'Год активности' })).toHaveCount(0);

    mock.activityEmpty = false;
    mock.activityFails = 503;
    await page.reload();
    await expect(panel.getByRole('heading', { name: 'Не удалось загрузить активность' })).toBeVisible();
    // остальная страница работает
    await expect(page.getByRole('heading', { name: 'Часы по месяцам' })).toBeVisible();
    mock.activityFails = null;
    await panel.getByRole('button', { name: 'Повторить' }).click();
    await expect(panel.getByRole('grid')).toBeVisible();

    mock.activityDelay = 1500;
    await page.reload();
    await expect(panel).toHaveAttribute('aria-busy', 'true');
    await expect(panel.locator('.ps-skeleton').first()).toBeVisible();
  });

  test('десктоп 1280: карта помещается целиком без прокрутки, клетка 18', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'desktop', 'десктопный сценарий');
    await page.setViewportSize({ width: 1280, height: 900 });
    await setup(page, context, baseURL!);
    await page.goto('/stats');
    const panel = page.getByRole('region', { name: 'Активность' });
    await panel.scrollIntoViewIfNeeded(); // Фаза 18: страница короче/выше, панель может быть дальше зоны подгрузки
    await expect(panel.getByRole('grid')).toBeVisible();
    const m = await panel.locator('.ps-heat__scroll').evaluate((el) => ({ left: el.scrollLeft, sw: el.scrollWidth, cw: el.clientWidth }));
    expect(m, JSON.stringify(m)).toMatchObject({ left: 0 });
    expect(m.sw).toBeLessThanOrEqual(m.cw + 1);
    expect(Math.round(await panel.locator('.ps-heat__c[data-l="0"]').first().evaluate((el) => el.getBoundingClientRect().width))).toBe(18);
  });

  test('мобильный: клетка 12, карта прокручивается и открыта на конце года, страница не ширится', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'mobile', 'мобильный сценарий');
    await setup(page, context, baseURL!);
    await page.goto('/stats');
    const panel = page.getByRole('region', { name: 'Активность' });
    await panel.scrollIntoViewIfNeeded(); // Фаза 18: страница короче/выше, панель может быть дальше зоны подгрузки
    await expect(panel.getByRole('grid')).toBeVisible();
    const size = await panel.locator('.ps-heat__c[data-l="0"]').first().evaluate((el) => el.getBoundingClientRect().width);
    expect(Math.round(size)).toBe(12);
    const sc = await panel.locator('.ps-heat__scroll').evaluate((el) => ({ left: el.scrollLeft, sw: el.scrollWidth, cw: el.clientWidth }));
    expect(sc.sw).toBeGreaterThan(sc.cw);
    expect(sc.left + sc.cw).toBeGreaterThanOrEqual(sc.sw - 2); // текущий год: открыта на конце
    await noOverflow(page);
    // сегодня видно без прокрутки карты
    await panel.scrollIntoViewIfNeeded();
    await expect(panel.locator('[data-today]')).toBeInViewport({ ratio: 0.5 });
    // тап по клетке показывает подсказку
    await panel.locator('[data-today]').tap();
    await expect(page.getByRole('tooltip')).toBeVisible();
  });
});

const forecast = (o: Record<string, unknown> = {}) => ({
  setId: 1, required: 54, earned: 49, progress: 91, remaining: { gold: 1, silver: 1, bronze: 3, total: 5 }, remainingHidden: 0,
  avgEarnedRate: 12.4, minEarnedRate: 1.2, ratesKnown: 5, platinumEarnedRate: 4.3, approximate: true, dlc: null, ...o,
});

test.describe('«Ближе всего к платине» (Коллекция)', () => {
  // на мобильном блок по умолчанию свёрнут (отдельный тест ниже): в остальных тестах развёрнут
  test.beforeEach(async ({ context }, info) => {
    if (!info.title.includes('свёрнут')) await context.addInitScript(() => localStorage.setItem('ps-near-open', '1'));
  });

  test('блок после «Играю»: прогресс, остаток по грейдам, редкость, клик открывает окно', async ({ page, context, baseURL }) => {
    const mock = await setup(page, context, baseURL!);
    mock.nearPlatinum = [{ id: 3, forecast: forecast() }, { id: 4, forecast: forecast({ progress: 70, avgEarnedRate: null, remaining: { gold: 0, silver: 2, bronze: 3, total: 5 }, approximate: false }) }];
    await page.goto('/');
    const block = page.locator('#near-platinum');
    await expect(block.getByRole('heading', { name: 'Ближе всего к платине' })).toBeVisible();
    const items = block.locator('.ps-near');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText('≈');
    await expect(items.first()).toContainText('91%');
    await expect(items.first()).toContainText('Осталось 5');
    await expect(items.first()).toContainText('ср. редкость 12,4%');
    await expect(items.first()).toHaveAttribute('aria-label', 'Horizon Forbidden West. Прогресс к платине примерно 91%, осталось 5 трофеев');
    await expect(items.nth(1)).toContainText('редкость неизвестна');
    await expect(items.nth(1)).not.toContainText('≈');
    await expect(items.nth(1).locator('.ps-near__g')).toHaveCount(2); // нулевые грейды не выводятся
    // десктоп: выше блока «Хроника»; мобильный (D-P1, пакет 2): сразу после первого блока, чтобы обложки были в первом экране
    const nearY = (await block.boundingBox())!.y;
    const chronY = (await page.locator('.ps-chron').first().boundingBox())!.y;
    if (page.viewportSize()!.width < 768) expect(nearY).toBeGreaterThan(chronY);
    else expect(nearY).toBeLessThan(chronY);
    await items.first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('скрывается при поиске, статусе, «Платине», сортировке и в режиме выбора; пусто и старый ответ без блока', async ({ page, context, baseURL }) => {
    const mock = await setup(page, context, baseURL!);
    mock.nearPlatinum = [{ id: 3, forecast: forecast() }];
    await page.goto('/');
    await expect(page.locator('#near-platinum')).toBeVisible();
    await page.goto('/?q=god');
    await expect(page.locator('.ps-results')).toBeVisible();
    await expect(page.locator('#near-platinum')).toHaveCount(0);
    await page.goto('/?status=playing');
    await expect(page.locator('#near-platinum')).toHaveCount(0);
    await page.goto('/?sort=hours');
    await expect(page.locator('.ps-results')).toBeVisible();
    await expect(page.locator('#near-platinum')).toHaveCount(0);
    await page.goto('/');
    await expect(page.locator('#near-platinum')).toBeVisible();
    await enterSelect(page);
    await expect(page.locator('#near-platinum')).toHaveCount(0);

    mock.nearPlatinum = [];
    await page.goto('/');
    await expect(page.locator('.ps-chron').first()).toBeVisible();
    await expect(page.locator('#near-platinum')).toHaveCount(0);
    mock.legacySummary = true;
    await page.reload();
    await expect(page.locator('.ps-chron').first()).toBeVisible();
    await expect(page.locator('#near-platinum')).toHaveCount(0);
  });

  test('мобильный: по умолчанию свёрнут до шапки, «Показать» разворачивает и запоминается', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'mobile', 'мобильный сценарий');
    const mock = await setup(page, context, baseURL!);
    mock.nearPlatinum = [3, 4].map((id) => ({ id, forecast: forecast() }));
    await page.goto('/');
    const block = page.locator('#near-platinum');
    await expect(block.getByRole('heading', { name: 'Ближе всего к платине' })).toBeVisible();
    await expect(block.locator('.ps-near')).toHaveCount(0);
    const tgl = block.getByRole('button', { name: 'Показать' });
    await expect(tgl).toHaveAttribute('aria-expanded', 'false');
    expect((await tgl.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await tgl.click();
    await expect(block.locator('.ps-near')).toHaveCount(2);
    await expect(block.getByRole('button', { name: 'Свернуть' })).toHaveAttribute('aria-expanded', 'true');
    await page.reload();
    await expect(block.locator('.ps-near')).toHaveCount(2);
  });

  test('мобильный: горизонтальный трек со snap, элемент 264, страница не ширится', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'mobile', 'мобильный сценарий');
    const mock = await setup(page, context, baseURL!);
    mock.nearPlatinum = [3, 4, 6, 7, 8].map((id) => ({ id, forecast: forecast() }));
    await page.goto('/');
    const list = page.locator('.ps-near__list');
    await expect(list).toBeVisible();
    expect(await list.evaluate((el) => getComputedStyle(el).scrollSnapType)).toContain('x');
    expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(Math.round((await page.locator('.ps-near').first().boundingBox())!.width)).toBe(264);
    await noOverflow(page);
  });
});

// забытые: без статуса, играл, запуск старше 90 суток
const forgottenGames = (): G[] => [
  ...seed(),
  { id: 31, title: 'Забытая Раз', lastPlayedAt: daysAgo(160), status: null, completedAt: null, droppedAt: null, playSeconds: 11400, playCount: 4, trophies: null },
  { id: 32, title: 'Забытая Два', lastPlayedAt: daysAgo(400), status: null, completedAt: null, droppedAt: null, playSeconds: 3600, playCount: 1, trophies: null },
];

test.describe('Забытые игры', () => {
  test('Коллекция: чип «Забытых: N» в «Не разобрано» ведёт в Разбор', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!, { games: forgottenGames() });
    await page.goto('/');
    const chip = page.locator('#unsorted').getByRole('link', { name: /Забытых: 2/ });
    await expect(chip).toBeVisible();
    await expect(page.locator('#unsorted').getByRole('link', { name: 'Разобрать по одной' })).toBeVisible();
    await chip.click();
    await expect(page).toHaveURL(/\/triage\?forgotten=1$/);
  });

  test('Коллекция: нет забытых или старый ответ — чипа нет', async ({ page, context, baseURL }) => {
    const mock = await setup(page, context, baseURL!);
    await page.goto('/');
    await expect(page.locator('#unsorted')).toBeVisible();
    await expect(page.locator('#unsorted').getByRole('link', { name: /Забытых/ })).toHaveCount(0);
    mock.games.push(...forgottenGames().slice(10));
    mock.legacySummary = true;
    await page.reload();
    await expect(page.locator('#unsorted')).toBeVisible();
    await expect(page.locator('#unsorted').getByRole('link', { name: /Забытых/ })).toHaveCount(0);
  });

  test.describe('Разбор (десктоп)', () => {
    test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'десктопный сценарий'); });
    test.use({ viewport: { width: 1440, height: 900 } });

    test('сегмент «Все / Забытые», чип и подсказка карточки, очередь только забытых, пустой экран', async ({ page, context, baseURL }) => {
      const mock = await setup(page, context, baseURL!, { games: forgottenGames() });
      await page.goto('/triage');
      const seg = page.getByRole('group', { name: 'Какие игры разбирать' });
      await expect(seg.getByRole('button', { name: /Все 4/ })).toHaveAttribute('aria-pressed', 'true');
      await expect(seg.getByRole('button', { name: 'Забытые 2' })).toBeVisible();
      await seg.getByRole('button', { name: 'Забытые 2' }).click();
      await expect(page).toHaveURL(/forgotten=1/);
      await expect.poll(() => mock.listCalls.at(-1)!.searchParams.get('forgotten')).toBe('only');
      // по последнему запуску: «Забытая Раз» (160 суток) свежее «Забытая Два» (400)
      await expect(page.getByRole('heading', { level: 2, name: 'Забытая Раз' })).toBeVisible();
      await expect(page.locator('.ps-fchip')).toHaveText('Забытая · не запускалась 5 мес.');
      await expect(page.locator('.ps-tri__fhint')).toContainText('Хороший кандидат на «Отложено» или «Брошено»');
      await expect(page.locator('.ps-queue__dot')).toHaveCount(1);
      await page.keyboard.press('3');
      await expect(page.getByRole('heading', { level: 2, name: 'Забытая Два' })).toBeVisible();
      await expect(page.locator('.ps-fchip')).toContainText('1 г.');
      await page.keyboard.press('3');
      await expect(page.getByRole('heading', { name: 'Забытых игр больше нет' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'К коллекции' })).toBeVisible();
      await page.getByRole('button', { name: 'Показать все' }).click();
      await expect(page).not.toHaveURL(/forgotten/);
      await expect(page.getByRole('heading', { level: 2, name: 'Tetris Effect' })).toBeVisible();
      // незабытая игра чипа не имеет
      await expect(page.locator('.ps-fchip')).toHaveCount(0);
      await expect(page.getByRole('group', { name: 'Какие игры разбирать' })).toHaveCount(0); // забытых больше нет
    });

    test('без забытых сегмента нет', async ({ page, context, baseURL }) => {
      await setup(page, context, baseURL!);
      await page.goto('/triage');
      await expect(page.getByRole('heading', { level: 2, name: 'Tetris Effect' })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Какие игры разбирать' })).toHaveCount(0);
    });
  });

  test('Разбор (мобильный): чип «Забытая» на карточке, срок в подписи, сегмент во всю ширину', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'mobile', 'мобильный сценарий');
    await setup(page, context, baseURL!, { games: forgottenGames() });
    await page.goto('/triage?forgotten=1');
    await expect(page.locator('.ps-stack3__fg')).toHaveText('Забытая');
    await expect(page.locator('.ps-stack3__cap')).toContainText('не запускалась 5 мес.');
    const seg = await page.getByRole('group', { name: 'Какие игры разбирать' }).boundingBox();
    expect(seg!.width).toBeGreaterThan(300);
    await noOverflow(page);
  });
});

test.describe('Итоги: слайд редких трофеев', () => {
  const Y = THIS_YEAR;
  const wrapped = (rareList: unknown) => ({
    year: Y, mode: 'story', period: { from: `${Y}-01-01`, to: `${Y}-12-31`, fromUtc: `${Y - 1}-12-31T21:00:00.000Z`, toUtc: `${Y}-12-31T21:00:00.000Z` },
    years: [{ year: Y, hasData: true }], profile: { onlineId: 'Artem_PS', avatarUrl: null }, firstSnapshotDate: `${Y}-03-04`, periodPartial: false,
    slides: ['start', 'trophies', 'final'], emptyState: null,
    hours: { hasData: false, total: null, days: null, byMonth: Array(12).fill(null), estimatedByMonth: Array(12).fill(0), estimatedHours: 0, hasEstimate: false, topMonth: null },
    topGames: { hasData: false, items: [] },
    finished: { hasData: false, completed: { count: 0, items: [] }, dropped: { count: 0, items: [] }, busiestMonth: null },
    trophies: { hasData: true, counts: { platinum: 1, gold: 1, silver: 1, bronze: 1, total: 4 }, platinum: { first: null, last: null, rarest: null }, ...(rareList === undefined ? {} : { rare: rareList }) },
    genres: { hasData: false, items: [] }, longestGame: { hasData: false, seconds: 0, hours: 0, estimated: false, playCount: 0, game: null },
  });
  const open = async (page: Page, context: BrowserContext, baseURL: string, rareList: unknown) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
    await mockApi(page);
    await page.route(/\/api\/wrapped/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: wrapped(rareList) }) }));
    await page.goto('/wrapped');
    await page.getByRole('button', { name: 'Смотреть итоги' }).click();
    await expect(page.locator('.ps-story__stage')).toBeVisible();
  };

  test('слайд после «Трофеи»: сегменты прогресса, №1 крупно, №2-5 строками, редкость словом и сегментами', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, RARE_PERIOD.map((r) => ({ ...r, game: r.game })));
    const stage = page.locator('.ps-story__stage');
    await expect(page.locator('.ps-story__seg')).toHaveCount(4); // start, trophies, rare, final
    await page.keyboard.press('ArrowRight');
    await expect(stage).toHaveAttribute('data-slide', 'trophies');
    await page.keyboard.press('ArrowRight');
    await expect(stage).toHaveAttribute('data-slide', 'rareTrophies');
    await expect(page.getByRole('heading', { name: 'Твои самые редкие трофеи' })).toBeVisible();
    await expect(stage.locator('.ps-rares__pct')).toHaveText('0,8%');
    await expect(stage).toContainText('игроков получили этот трофей');
    await expect(stage).toContainText('Без единой царапины');
    await expect(stage.locator('.ps-rares__row')).toHaveCount(4);
    await expect(stage.locator('.ps-rares__row').nth(2)).toContainText('Старая игра'); // сирота: подпись setName
    await expect(stage.locator('.ps-rares__rar').first()).toContainText('Ультра-редкий');
    // всё помещается в окно истории
    const box = (await stage.boundingBox())!;
    const last = (await stage.locator('.ps-rares__row').last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(box.y + box.height);
    await page.keyboard.press('ArrowRight');
    await expect(stage).toHaveAttribute('data-slide', 'final');
  });

  test('скриншоты слайда в семи темах', async ({ page, context, baseURL }, info) => {
    test.skip(!SHOTS, 'скриншоты только по SHOTS_DIR');
    await open(page, context, baseURL!, RARE_PERIOD);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.ps-story__stage')).toHaveAttribute('data-slide', 'rareTrophies');
    for (const t of ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5']) {
      await setTheme(page, t);
      await page.addStyleTag({ content: ':root{--dur-slide:600000ms !important}' });
      await page.waitForTimeout(700);
      await page.locator('.ps-story__stage').screenshot({ path: `${SHOTS}/${info.project.name}-${t}-slide-rare.png` });
    }
  });

  test('нет редких или старый ответ: слайда нет, сегменты по факту', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, []);
    await expect(page.locator('.ps-story__seg')).toHaveCount(3);
    await page.keyboard.press('Escape');
    await open(page, context, baseURL!, undefined);
    await expect(page.locator('.ps-story__seg')).toHaveCount(3);
  });
});

test.describe('Скриншоты фазы (SHOTS_DIR)', () => {
  test.skip(!SHOTS, 'скриншоты только по SHOTS_DIR');
  const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];
  test('блоки в семи темах', async ({ page, context, baseURL }, info) => {
    test.setTimeout(240_000);
    const mock = await setup(page, context, baseURL!, { rare: { period: RARE_PERIOD, allTime: RARE_ALL }, games: forgottenGames() });
    mock.nearPlatinum = [3, 4, 1, 2, 10].map((id, i) => ({ id, forecast: forecast({ progress: 91 - i * 6, avgEarnedRate: i === 3 ? null : 12.4 - i }) }));
    const tag = info.project.name;
    await page.goto('/stats');
    await page.locator('.ps-act').scrollIntoViewIfNeeded();
    await expect(page.getByRole('grid')).toBeVisible();
    for (const t of THEMES) {
      await setTheme(page, t);
      await page.waitForTimeout(150);
      await page.locator('.ps-rare').scrollIntoViewIfNeeded();
      await page.locator('.ps-rare').screenshot({ path: `${SHOTS}/${tag}-${t}-rare.png` });
      await page.locator('.ps-act').scrollIntoViewIfNeeded();
      await page.locator('.ps-act').screenshot({ path: `${SHOTS}/${tag}-${t}-activity.png` });
    }
    await page.goto('/');
    await expect(page.locator('#near-platinum')).toBeVisible();
    for (const t of THEMES) {
      await setTheme(page, t);
      await page.waitForTimeout(150);
      await page.locator('#near-platinum').screenshot({ path: `${SHOTS}/${tag}-${t}-near.png` });
      await page.locator('#unsorted .ps-block__head').screenshot({ path: `${SHOTS}/${tag}-${t}-unsorted-head.png` });
    }
    await page.goto('/triage?forgotten=1');
    await expect(page.locator('.ps-tri')).toBeVisible();
    for (const t of THEMES) {
      await setTheme(page, t);
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${SHOTS}/${tag}-${t}-triage.png` });
    }
  });
});
