// Хвосты 2026-11-02 (frontend): смена периода в Статистике под мягким лоадером; возврат фокуса, когда игра исчезла из списка.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { signedSession } from './session';

const THIS_YEAR = new Date(Date.now() + 3 * 3600_000).getUTCFullYear();
const ok = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
const z = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };
const overlay = (page: Page) => page.getByTestId('loader-overlay');

function statsBody(year: number) {
  const iso = (m: number) => `${year}-${String(m).padStart(2, '0')}-10T10:00:00.000Z`;
  const g = { id: 1, title: 'Игра 1', coverUrl: null, platform: 'PS5', playSeconds: 36000, hours: 10, playCount: 3, lastPlayedAt: iso(3), status: 'completed', completedAt: iso(3), droppedAt: null, trophies: null, genres: [{ key: 'ACTION', label: 'Экшен' }] };
  return {
    period: { type: 'year', year, month: null, from: `${year}-01-01`, to: `${year}-12-31`, fromUtc: `${year - 1}-12-31T21:00:00.000Z`, toUtc: `${year}-12-31T21:00:00.000Z` },
    years: [THIS_YEAR - 2, THIS_YEAR - 1, THIS_YEAR], header: { completed: 3, dropped: 0, hours: 50, platinum: 0 },
    hours: { byMonth: Array(12).fill(null).map((_, i) => (i < 5 ? 10 : null)), estimatedByMonth: Array(12).fill(0), estimatedHours: 0, hasEstimate: false, firstSnapshotDate: `${year}-01-15`, periodPartial: false },
    genres: { hasData: true, items: [{ key: 'ACTION', label: 'Экшен', value: 3, gameIds: [1] }], games: { 1: { id: 1, title: 'Игра 1', coverUrl: null } } },
    top: { byHours: [{ game: g, hours: 12.5, estimated: false }], byTrophies: [] },
    rareTrophies: { period: [], allTime: [] },
    trophies: { counts: { ...z }, byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...z })) },
    finished: { groups: [] },
    played: { games: { 1: g }, groups: [{ month: `${year}-03`, year, monthNumber: 3, completed: 1, dropped: 0, items: [{ gameId: 1, hours: 5, estimated: false, finished: 'completed', finishedAt: iso(3) }] }] },
  };
}

test('Статистика: смена периода под мягким оверлеем, данные остаются, ввод не блокируется', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await mockApi(page);
  const state = { delay: 0, years: [] as number[] };
  await page.route(/\/api\/stats(\?|$)/, async (r) => {
    const year = Number(new URL(r.request().url()).searchParams.get('year') ?? THIS_YEAR);
    state.years.push(year);
    if (state.delay) await new Promise((res) => setTimeout(res, state.delay));
    await r.fulfill(ok(statsBody(year)));
  });
  await page.goto('/stats');
  const label = page.locator('.ps-st-nav__label');
  await expect(label).toContainText(String(THIS_YEAR));
  const data = page.locator('.ps-st');
  await expect(data).toBeVisible();
  await expect(overlay(page)).toHaveCount(0, { timeout: 3000 });

  state.delay = 1500;
  const prev = page.getByRole('button', { name: 'Предыдущий год' });
  await prev.click();
  await expect(overlay(page)).toBeVisible({ timeout: 1200 });
  // мягкий оверлей: без blur/inert, прежние данные на месте и помечены устаревшими
  expect(await overlay(page).getAttribute('data-blocking')).toBe('false');
  await expect(overlay(page)).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('.ps-stats-page')).not.toHaveAttribute('inert', /.*/);
  await expect(page.locator('.ps-stats-page')).not.toHaveAttribute('aria-busy', /.*/);
  await expect(data).toBeVisible();
  await expect(data).toHaveAttribute('data-stale', 'true');
  await expect(data.getByText('Игра 1').first()).toBeVisible(); // данные не заменены скелетом периода
  // ввод не заблокирован: кнопка периода жива и принимает второй клик, пока идёт загрузка
  await expect(prev).toBeFocused();
  await prev.click();
  await expect(label).toContainText(String(THIS_YEAR - 2));
  await expect(page.getByRole('button', { name: 'Предыдущий год' })).toBeDisabled();
  await expect(overlay(page)).toHaveCount(0, { timeout: 6000 });
  await expect(data).not.toHaveAttribute('data-stale', 'true');
  expect(state.years).toContain(THIS_YEAR - 2);
});

// --- Фокус, когда игра исчезла из списка ---
const bl = (id: number, title: string): G => ({
  id, title, lastPlayedAt: null, status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null, genres: ['ACTION'],
});
async function openBacklog(page: Page, context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, [bl(1, 'Альфа Экшен'), bl(2, 'Браво Хоррор'), bl(3, 'Чарли РПГ'), bl(4, 'Дельта Гонки')]);
  await page.goto('/backlog');
  await page.locator('.ps-card:not(.ps-card--sk)').first().waitFor();
}
const activeInfo = (page: Page) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null;
  return { tag: a?.tagName ?? '', label: a?.getAttribute('aria-label') ?? a?.textContent?.trim() ?? '' };
});

test('Бэклог: игра ушла из списка по кнопке на карточке, фокус переходит на следующую карточку, не на body', async ({ page, context, baseURL }, info) => {
  test.skip(info.project.name !== 'desktop', 'клавиатурный сценарий; на мобильном карточки Бэклога могут быть строками');
  await openBacklog(page, context, baseURL!);
  const card = page.locator('.ps-card', { hasText: 'Браво Хоррор' });
  const btn = card.getByRole('button', { name: 'Начать играть' });
  await btn.focus();
  await expect(btn).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.ps-card', { hasText: 'Браво Хоррор' })).toHaveCount(0);
  await expect.poll(async () => (await activeInfo(page)).tag).not.toBe('BODY');
  const a = await activeInfo(page);
  expect(a.label).toBe('Открыть: Чарли РПГ');
});

test('Бэклог: последняя карточка ушла, фокус на предыдущей', async ({ page, context, baseURL }, info) => {
  test.skip(info.project.name !== 'desktop', 'клавиатурный сценарий');
  await openBacklog(page, context, baseURL!);
  const btn = page.locator('.ps-card', { hasText: 'Дельта Гонки' }).getByRole('button', { name: 'Начать играть' });
  await btn.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.ps-card', { hasText: 'Дельта Гонки' })).toHaveCount(0);
  await expect.poll(async () => (await activeInfo(page)).label).toBe('Открыть: Чарли РПГ');
});

test('Бэклог: ушли все игры, фокус на заголовок вида', async ({ page, context, baseURL }, info) => {
  test.skip(info.project.name !== 'desktop', 'клавиатурный сценарий');
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await mockApi(page, [bl(1, 'Альфа Экшен')]);
  await page.goto('/backlog');
  await page.locator('.ps-card:not(.ps-card--sk)').first().waitFor();
  const btn = page.getByRole('button', { name: 'Начать играть' });
  await btn.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.ps-card')).toHaveCount(0);
  await expect.poll(async () => (await activeInfo(page)).tag).not.toBe('BODY');
});
