// Фаза 10 (UI): поповер жанров с миниатюрами (HoverCard) и топ-10 игр на /stats.
// /api/stats эмулируется по контракту §10.1, §13 (БД в e2e недоступна).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const SHOTS = process.env.SHOTS_DIR;
const z = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };
const isMobile = (name: string) => name === 'mobile';

const game = (id: number, title: string) => ({
  id, title, coverUrl: null, bannerUrl: null, platform: 'PS5', playSeconds: 72000, hours: 20, playCount: 9, lastPlayedAt: '2026-03-20T10:00:00.000Z',
  status: 'completed', completedAt: '2026-03-10T10:00:00.000Z', droppedAt: null, trophies: null, genres: [{ key: 'ACTION', label: 'Экшен' }], hiddenAt: null,
});

type Opts = { emptyTop?: boolean };
function payload(o: Opts = {}) {
  const ids = Array.from({ length: 14 }, (_, i) => i + 1);
  const games: Record<string, { id: number; title: string; coverUrl: null }> = Object.fromEntries(ids.map((id) => [String(id), { id, title: `Игра ${id}`, coverUrl: null }]));
  games['999'] = { id: 999, title: 'Призрак', coverUrl: null };
  return {
    period: { type: 'year', year: 2026, month: null, from: '2026-01-01', to: '2026-12-31', fromUtc: '2025-12-31T21:00:00.000Z', toUtc: '2026-12-31T21:00:00.000Z' },
    years: [2026],
    header: { completed: 1, dropped: 0, hours: 40, platinum: 1 },
    hours: { byMonth: [null, 10, 30, ...Array(9).fill(null)], estimatedByMonth: Array(12).fill(0), estimatedHours: 0, hasEstimate: false, firstSnapshotDate: '2026-03-01', periodPartial: true },
    genres: {
      hasData: true,
      items: [
        { key: 'ACTION', label: 'Экшен', value: 14.5, gameIds: ids },
        { key: 'RACING', label: 'Гонки', value: 4, gameIds: [999] },
        { key: 'HORROR', label: 'Хоррор', value: 2, gameIds: [] },
        { key: 'ARCADE', label: 'Аркады', value: 0, gameIds: [2] },
      ],
      games,
    },
    top: o.emptyTop
      ? { byHours: [], byTrophies: [] }
      : {
        byHours: [
          { game: game(2, 'Игра Два'), hours: 85.4, estimated: false },
          { game: game(1, 'Игра Один'), hours: 42.7, estimated: true },
        ],
        byTrophies: [{ game: game(1, 'Игра Один'), points: 840, counts: { platinum: 1, gold: 5, silver: 12, bronze: 20, total: 38 } }],
      },
    trophies: { counts: { platinum: 1, gold: 5, silver: 12, bronze: 20, total: 38 }, byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...z })) },
    finished: { groups: [] },
    played: { games: {}, groups: [] },
  };
}

async function open(page: Page, context: BrowserContext, baseURL: string, o: Opts = {}) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page);
  await page.route(/\/api\/stats\?/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: payload(o) }) }));
  await page.goto('/stats?period=year&year=2026');
  await expect(page.getByRole('heading', { name: 'Жанры' })).toBeVisible();
  return mock;
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const genreRow = (page: Page, label: string) => page.locator('.ps-st-genres__row').filter({ hasText: label });
const theme = (page: Page, t: 'night' | 'graphite' | 'ps5') =>
  page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);

test.describe('Фаза 10: поповер жанров', () => {
  test.beforeEach(({}, info) => { test.skip(isMobile(info.project.name), 'hover и клавиатура: десктоп'); });

  test('hover открывает поповер с заголовком, значением и миниатюрами; уход курсора закрывает', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    const row = genreRow(page, 'Экшен');
    await expect(row).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await row.hover();
    const pop = page.getByRole('dialog', { name: 'Игры жанра Экшен' });
    await expect(pop).toBeVisible();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(pop.locator('.ps-gp__head')).toContainText('Экшен');
    await expect(pop.locator('.ps-gp__head')).toContainText('14,5 ч · 14 игр');
    await expect(pop.locator('.ps-gp__thumb')).toHaveCount(12);
    await expect(pop.locator('.ps-gp__more')).toHaveText('+2');
    // boundingBox снимается во время анимации ps-pop-in: допуск ±1 px (BUG-Q1)
    expect(Math.abs((await pop.boundingBox())!.width - 304)).toBeLessThanOrEqual(1.5);
    expect(await pop.getAttribute('role')).toBe('dialog'); // не меню
    await expect(pop.locator('.ps-gp__thumb').first()).toHaveAttribute('title', 'Игра 1');
    await page.mouse.move(5, 5);
    await expect(pop).toHaveCount(0);
    await expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  test('курсор может перейти в поповер: он не закрывается', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await genreRow(page, 'Экшен').hover();
    const pop = page.getByRole('dialog', { name: 'Игры жанра Экшен' });
    await expect(pop).toBeVisible();
    await pop.locator('.ps-gp__thumb').nth(3).hover();
    await page.waitForTimeout(400);
    await expect(pop).toBeVisible();
  });

  test('клавиатура: focus-visible открывает сразу, Tab ходит по миниатюрам, Esc закрывает и возвращает фокус на строку', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    const row = genreRow(page, 'Экшен');
    await row.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab'); // клавиатурный фокус на строку
    await expect(row).toBeFocused();
    const pop = page.getByRole('dialog', { name: 'Игры жанра Экшен' });
    await expect(pop).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(pop.locator('.ps-gp__thumb').first()).toBeFocused();
    await expect(pop).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(row).toBeFocused();
    await expect(page.getByRole('dialog', { name: /Игра/ })).toHaveCount(0); // Esc закрыл только поповер
  });

  test('миниатюра открывает окно игры, поповер закрывается, фокус вернётся на строку', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!);
    const row = genreRow(page, 'Экшен');
    await row.hover();
    const pop = page.getByRole('dialog', { name: 'Игры жанра Экшен' });
    await pop.getByRole('button', { name: 'Игра 3' }).click();
    await expect(pop).toHaveCount(0);
    // Фаза 18 (§8.6): переход на /?game=3 (router.push), окно поверх Коллекции; полные данные игры 3 из GET /api/games/3
    await expect(page).toHaveURL(/\/\?game=3$/);
    const dlg = page.getByRole('dialog').filter({ has: page.getByRole('tab', { name: /Обзор/ }) });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('heading', { level: 2, name: 'Horizon Forbidden West' })).toBeVisible();
    expect(m.detailCalls).toContain(3);
    await expect(dlg.locator('.ps-gd__tile').first()).toContainText('28 ч 17 м');
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    // закрытие делает back(): возврат на /stats (страница пересоздаётся, фокус на строке жанра не сохраняется)
    await expect(page).toHaveURL(/\/stats/);
    await expect(page.getByRole('heading', { name: 'Жанры' })).toBeVisible();
  });

  test('игра из поповера не найдена: «Игра не найдена» и «Закрыть»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await genreRow(page, 'Гонки').hover();
    await page.getByRole('dialog', { name: 'Игры жанра Гонки' }).getByRole('button', { name: 'Призрак' }).click();
    // Фаза 18 (§8.6): неизвестный id: тост, параметр убран из адреса, окна нет (остаёмся на «/»)
    await expect(page.getByText('Игра не найдена. Возможно, ссылка устарела.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).not.toHaveURL(/game=/);
  });

  test('жанр без игр: строка не интерактивна; жанр без часов: только число игр', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await expect(page.locator('.ps-st-genres__row').filter({ hasText: 'Хоррор' })).not.toHaveAttribute('aria-haspopup', /.*/);
    await expect(page.locator('li').filter({ hasText: 'Хоррор' }).getByRole('button')).toHaveCount(0);
    await genreRow(page, 'Аркады').hover();
    const head = page.getByRole('dialog', { name: 'Игры жанра Аркады' }).locator('.ps-gp__head');
    await expect(head).toContainText('1 игра');
    await expect(head).not.toContainText(' ч');
  });

  test('три темы: поповер без переполнения', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    for (const t of ['night', 'graphite', 'ps5'] as const) {
      await theme(page, t);
      await genreRow(page, 'Экшен').hover();
      await expect(page.getByRole('dialog', { name: 'Игры жанра Экшен' })).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/p10-genres-${t}.png` });
      await page.mouse.move(5, 5);
      await expect(page.getByRole('dialog', { name: 'Игры жанра Экшен' })).toHaveCount(0);
    }
  });
});

test.describe('Фаза 10: поповер жанров на мобильном', () => {
  test.beforeEach(({}, info) => { test.skip(!isMobile(info.project.name), 'мобильный'); });

  test('тап по строке открывает bottom sheet: сетка 4 колонки, до 16 миниатюр с названиями', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await genreRow(page, 'Экшен').click();
    const sheet = page.getByRole('dialog', { name: 'Экшен' });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.ps-gp__head')).toContainText('14,5 ч · 14 игр');
    const cols = await sheet.locator('.ps-gp__grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(4);
    await expect(sheet.locator('.ps-gp__thumb')).toHaveCount(14);
    await expect(sheet.locator('.ps-gp__name').first()).toHaveText('Игра 1');
    const b = await sheet.locator('.ps-gp__thumb').first().boundingBox();
    expect(b!.height).toBeGreaterThanOrEqual(44);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await sheet.getByRole('button', { name: 'Игра 3' }).click();
    await expect(page.getByRole('dialog', { name: 'Horizon Forbidden West' })).toBeVisible();
  });
});

test.describe('Фаза 10: топ-10 игр', () => {
  test('режим «Часы»: ранги, значения, оценка с «≈»; открытие окна игры', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Топ-10 игр' }) });
    await expect(panel.getByRole('button', { name: 'Часы', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel).toContainText('за выбранный период');
    const rows = panel.locator('li.ps-top__li');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.ps-top__rank')).toHaveText('1');
    await expect(rows.nth(0).locator('.ps-top__name')).toHaveText('Игра Два');
    await expect(rows.nth(0).locator('.ps-top__val')).toHaveText('85 ч 24 м');
    await expect(rows.nth(1).locator('.ps-top__val')).toHaveText(/≈\s*42 ч 42 м/);
    await expect(rows.nth(1).locator('.ps-top__val')).toHaveAttribute('title', 'Часть часов оценена');
    // бар лидера = 100%, второго около 50%
    const w = await rows.evaluateAll((els) => els.map((e) => { const i = e.querySelector('.ps-top__bar i') as HTMLElement; return i.getBoundingClientRect().width / (i.parentElement as HTMLElement).getBoundingClientRect().width; }));
    expect(w[0]).toBeCloseTo(1, 1);
    expect(w[1]).toBeCloseTo(0.5, 1);
    await rows.nth(0).getByRole('button').click();
    // Фаза 18 (§8.6): окно открывается на /?game=2 поверх Коллекции (данные игры из каталога мока), «назад» возвращает на /stats
    await expect(page).toHaveURL(/\/\?game=2$/);
    await expect(page.getByRole('dialog', { name: 'Ведьмак 3: Дикая Охота' })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/stats/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('режим «Трофеи»: очки, подсказка, счётчики без нулей, подзаголовок', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Топ-10 игр' }) });
    await panel.getByRole('button', { name: 'Трофеи', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Трофеи', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel).toContainText('Очки за трофеи периода: платина 300, золото 90, серебро 30, бронза 15');
    const row = panel.locator('li.ps-top__li');
    await expect(row).toHaveCount(1);
    await expect(row.locator('.ps-top__val')).toHaveText('840 очк.');
    await expect(row.getByRole('button')).toHaveAttribute('aria-label', /840 очков: платина 1, золото 5, серебро 12, бронза 20/);
    await expect(row.locator('.ps-top__counts > span')).toHaveCount(4);
    await panel.getByRole('button', { name: 'Часы', exact: true }).click();
    await expect(panel.locator('li.ps-top__li')).toHaveCount(2); // выбор не хранится, переключается свободно
  });

  test('пусто: тексты по режимам', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { emptyTop: true });
    const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Топ-10 игр' }) });
    await expect(panel.locator('.ps-top__empty')).toHaveText('Нет данных за период');
    await panel.getByRole('button', { name: 'Трофеи', exact: true }).click();
    await expect(panel.locator('.ps-top__empty')).toHaveText('В этом периоде трофеев не получено');
  });

  test('выбор по умолчанию «Часы» после перезагрузки; без переполнения; три темы', async ({ page, context, baseURL }, info) => {
    await open(page, context, baseURL!);
    const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Топ-10 игр' }) });
    await panel.getByRole('button', { name: 'Трофеи', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Топ-10 игр' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Часы', exact: true })).toHaveAttribute('aria-pressed', 'true');
    for (const t of ['night', 'graphite', 'ps5'] as const) {
      await theme(page, t);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/p10-top-${t}-${info.project.name}.png` });
    }
    if (isMobile(info.project.name)) {
      const h = await panel.locator('li.ps-top__li').first().boundingBox();
      expect(h!.height).toBeGreaterThanOrEqual(64);
    }
  });
});
