// Фаза 8 (UI): «Игры месяца» на /stats, сброс статуса (игра, выделение, вся коллекция с откатом), скрытие и возврат из «Скрытых».
// API эмулируется по контракту §9.4–9.10 и §10.1 `played` (e2e/collection-mock.ts), БД не нужна.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed, type Mock } from './collection-mock';
import { signedSession } from './session';

const SHOTS = process.env.SHOTS_DIR;
const z = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };

async function login(context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
}
async function openCollection(page: Page, context: BrowserContext, baseURL: string, url = '/'): Promise<Mock> {
  await login(context, baseURL);
  const mock = await mockApi(page, seed());
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Статус' }).getByRole('button', { name: /^Все/ })).toContainText(/\d/);
  return mock;
}
const coll = (page: Page) => page.locator('section[aria-labelledby="coll-title"]');
const card = (page: Page, title: string) =>
  coll(page).locator('article.ps-card').filter({ has: page.locator('.ps-card__title', { hasText: new RegExp(`^${title}$`) }) });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const isMobile = (name: string) => name === 'mobile';

/** Пункт меню коллекции: десктоп = «…», мобильный = sheet «Фильтры». */
async function collectionMenu(page: Page, mobile: boolean, item: RegExp) {
  if (mobile) await page.getByRole('button', { name: 'Фильтры' }).click();
  else await page.getByRole('button', { name: 'Ещё: действия с коллекцией' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

const statsGame = (id: number, title: string, status: 'completed' | 'dropped' | 'playing') => ({
  id, title, coverUrl: null, platform: 'PS5', playSeconds: 72000, hours: 20, playCount: 9, lastPlayedAt: '2026-03-20T10:00:00.000Z',
  status, completedAt: status === 'completed' ? '2026-03-10T10:00:00.000Z' : null, droppedAt: status === 'dropped' ? '2026-03-12T10:00:00.000Z' : null,
  trophies: null, genres: [{ key: 'ACTION', label: 'Экшен' }], hiddenAt: null,
});

function statsPayload() {
  const one = statsGame(1, 'Игра Один', 'completed');
  return {
    period: { type: 'year', year: 2026, month: null, from: '2026-01-01', to: '2026-12-31', fromUtc: '2025-12-31T21:00:00.000Z', toUtc: '2026-12-31T21:00:00.000Z' },
    years: [2026],
    header: { completed: 1, dropped: 1, hours: 40, platinum: 0 },
    hours: { byMonth: [null, 10, 30, ...Array(9).fill(null)], estimatedByMonth: [0, 7.5, ...Array(10).fill(0)], estimatedHours: 7.5, hasEstimate: true, firstSnapshotDate: '2026-03-01', periodPartial: true },
    genres: { hasData: false, items: [], games: {} }, top: { byHours: [], byTrophies: [] },
    trophies: { counts: z, byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...z })) },
    finished: { groups: [] },
    played: { games: { 1: one, 2: statsGame(2, 'Игра Два', 'dropped'), 3: statsGame(3, 'Игра Три', 'playing') }, groups: [
      { month: '2026-03', year: 2026, monthNumber: 3, completed: 1, dropped: 1, items: [
        { gameId: 2, hours: 2, estimated: false, finished: 'dropped', finishedAt: '2026-03-12T10:00:00.000Z' },
        { gameId: one.id, hours: 12.5, estimated: false, finished: 'completed', finishedAt: '2026-03-10T10:00:00.000Z' },
        { gameId: 3, hours: 0.5, estimated: false, finished: null, finishedAt: null },
      ] },
      { month: '2026-02', year: 2026, monthNumber: 2, completed: 0, dropped: 0, items: [
        { gameId: one.id, hours: 7.5, estimated: true, finished: null, finishedAt: null },
      ] },
    ] },
  };
}

test.describe('Фаза 8: «Игры месяца» на /stats', () => {
  test('игра в двух месяцах: фигура только в месяце события, часы за месяц, «≈» при оценке', async ({ page, context, baseURL }, info) => {
    await login(context, baseURL!);
    await mockApi(page);
    await page.route(/\/api\/stats\?/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: statsPayload() }) }));
    await page.goto('/stats?period=year&year=2026');
    const block = page.locator('section[aria-labelledby="st-played"]');
    await expect(block.getByRole('heading', { name: 'Игры месяца' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Пройдено и брошено' })).toHaveCount(0);
    await expect(block.locator('.ps-block__cnt')).toHaveText('3'); // разных игр, не карточек
    await expect(block.locator('h3.ps-month')).toHaveText([/Март.*1.*1.*3 игры/, /Февраль.*1 игра/]);

    const march = block.locator('.ps-st-played__month').nth(0);
    const feb = block.locator('.ps-st-played__month').nth(1);
    const oneMarch = march.locator('article.ps-card').filter({ has: page.locator('[title="Игра Один"]') });
    const oneFeb = feb.locator('article.ps-card').filter({ has: page.locator('[title="Игра Один"]') });
    await expect(oneMarch).toHaveCount(1);
    await expect(oneFeb).toHaveCount(1);
    // март: событие «пройдена» -> фигура и дата; февраль: просто играли -> без фигуры и даты
    await expect(oneMarch.locator('.ps-card__glyph')).toHaveAttribute('title', 'Пройдена в этом месяце');
    await expect(oneMarch.locator('.ps-card__date')).toHaveText('10 мар.');
    await expect(oneFeb.locator('.ps-card__glyph')).toHaveCount(0);
    await expect(oneFeb.locator('.ps-card__date')).toHaveCount(0);
    await expect(march.locator('article.ps-card').filter({ has: page.locator('[title="Игра Три"]') }).locator('.ps-card__glyph')).toHaveCount(0);
    // часы за месяц под обложкой
    await expect(oneMarch.locator('.ps-card__meta')).toHaveText('12 ч 30 м');
    await expect(oneFeb.locator('.ps-card__meta')).toHaveText('≈ 7 ч 30 м');
    await expect(oneFeb.locator('.ps-card__meta')).toHaveAttribute('aria-label', 'примерно 7 ч 30 м за месяц');
    await expect(oneMarch.locator('.ps-card__meta')).toBeVisible();
    // клик открывает окно игры
    await oneFeb.locator('.ps-card__hit').click();
    await expect(page.getByRole('dialog', { name: 'Игра Один' })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined|null|Invalid/);
    if (SHOTS) {
      await block.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/p8-stats-played-${info.project.name}.png`, fullPage: true });
    }
  });

  test('пустой период: блока нет', async ({ page, context, baseURL }) => {
    await login(context, baseURL!);
    await mockApi(page);
    const empty = { ...statsPayload(), played: { games: {}, groups: [] } };
    await page.route(/\/api\/stats\?/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: empty }) }));
    await page.goto('/stats?period=year&year=2026');
    await expect(page.getByRole('heading', { name: 'Часы по месяцам' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Игры месяца' })).toHaveCount(0);
  });
});

test.describe('Фаза 8: сброс статуса', () => {
  test('в окне игры: «Сбросить статус» = PUT null, тост «Отменить» возвращает статус', async ({ page, context, baseURL }, info) => {
    const mock = await openCollection(page, context, baseURL!);
    await card(page, 'God of War').locator('.ps-card__hit').click();
    const dlg = page.getByRole('dialog', { name: 'God of War' });
    await expect(dlg).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/p8-dialog-${info.project.name}.png` });
    await dlg.getByRole('button', { name: 'Сбросить статус' }).click();
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ method: 'PUT', body: { status: null } });
    expect(mock.mutations.at(-1)?.url).toMatch(/\/api\/games\/4\/status$/);
    await expect(dlg.locator('.ps-chip')).toHaveText(/Без статуса/);
    await expect(dlg.getByRole('button', { name: 'Сбросить статус' })).toHaveCount(0); // статуса нет — кнопки нет
    await expect(page.getByRole('status').filter({ hasText: 'Статус сброшен' })).toBeVisible();
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect.poll(() => mock.games.find((g) => g.id === 4)?.status).toBe('completed');
    expect(mock.games.find((g) => g.id === 4)?.completedAt).toBe('2026-02-14T10:00:00.000Z');
    await expect(dlg.locator('.ps-chip')).toHaveText(/Пройдено/);
  });

  test('в режиме «Выбрать»: явная кнопка «Сбросить статус» шлёт status-bulk null', async ({ page, context, baseURL }) => {
    const mock = await openCollection(page, context, baseURL!, '/?status=completed&sort=title');
    await page.getByRole('button', { name: 'Выбрать' }).click();
    await card(page, 'God of War').locator('.ps-card__hit').click();
    await card(page, 'Ведьмак 3: Дикая Охота').locator('.ps-card__hit').click();
    const bar = page.getByRole('region', { name: 'Выбор игр' });
    await expect(bar.getByRole('button', { name: 'Сбросить статус' })).toBeEnabled();
    await bar.getByRole('button', { name: 'Сбросить статус' }).click();
    await expect.poll(() => mock.mutations.find((m) => m.url.endsWith('/status-bulk'))?.body).toMatchObject({ status: null });
    const ids = (mock.mutations.find((m) => m.url.endsWith('/status-bulk'))?.body as { ids: number[] }).ids;
    expect(ids.sort()).toEqual([2, 4]);
    expect(mock.games.find((g) => g.id === 4)?.status).toBeNull();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('BUG-P8-4: «Вернуть статусы из копии» в меню после перезагрузки; без копии пункта нет; после отката скрыт', async ({ page, context, baseURL }, info) => {
    const mock = await openCollection(page, context, baseURL!);
    const mobile = isMobile(info.project.name);
    const before = mock.games.map((g) => ({ id: g.id, status: g.status, completedAt: g.completedAt, droppedAt: g.droppedAt }));
    // копии нет: пункта в меню нет
    if (!mobile) {
      await page.getByRole('button', { name: 'Ещё: действия с коллекцией' }).click();
      await expect(page.getByRole('menuitem', { name: /Сбросить все статусы/ })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: /Вернуть статусы из копии/ })).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    mock.backups.push({ id: 1, reason: 'reset_all', rows: before.filter((g) => g.status) as never });
    for (const g of mock.games) { g.status = null; g.completedAt = null; g.droppedAt = null; }
    await page.reload();
    await collectionMenu(page, mobile, /Вернуть статусы из копии/);
    const dlg = page.getByRole('dialog', { name: 'Вернуть статусы из копии' });
    await expect(dlg).toContainText('Копия от 27.10.2026');
    await dlg.getByRole('button', { name: 'Вернуть статусы' }).click();
    await expect(dlg).toHaveCount(0);
    expect(mock.mutations.at(-1)?.body).toEqual({ backupId: 1 });
    await expect(page.getByRole('status').filter({ hasText: 'Статусы возвращены: 8 игр' })).toBeVisible();
    expect(mock.games.map((g) => ({ id: g.id, status: g.status, completedAt: g.completedAt, droppedAt: g.droppedAt }))).toEqual(before);
    if (!mobile) {
      await page.getByRole('button', { name: 'Ещё: действия с коллекцией' }).click();
      await expect(page.getByRole('menuitem', { name: /Вернуть статусы из копии/ })).toHaveCount(0);
    }
  });

  test('вся коллекция: подтверждение словом «СБРОС», {"confirm":"RESET"}, «Вернуть» восстанавливает из копии', async ({ page, context, baseURL }, info) => {
    const mock = await openCollection(page, context, baseURL!);
    const before = mock.games.map((g) => ({ id: g.id, status: g.status, completedAt: g.completedAt, droppedAt: g.droppedAt }));
    await collectionMenu(page, isMobile(info.project.name), /Сбросить все статусы/);
    const dlg = page.getByRole('dialog', { name: 'Сбросить все статусы' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('Статус будет сброшен у 8 игр');
    await expect(dlg).toContainText('Ручные даты прохождения и броска сотрутся');
    await expect(dlg).toContainText('сохраняется копия');
    const submit = dlg.getByRole('button', { name: 'Сбросить статусы' });
    await expect(submit).toBeDisabled();
    const input = dlg.getByRole('textbox', { name: /введи слово СБРОС/ });
    await input.fill('RESET');
    await expect(submit).toBeDisabled();
    await input.fill('сброс');
    await expect(submit).toBeEnabled();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/p8-reset-all-${info.project.name}.png` });
    await submit.click();
    await expect(dlg).toHaveCount(0);
    expect(mock.mutations.at(-1)).toMatchObject({ method: 'POST', body: { confirm: 'RESET' } });
    expect(mock.mutations.at(-1)?.url).toMatch(/\/api\/games\/status-reset-all$/);
    expect(mock.games.every((g) => g.status === null)).toBe(true);
    await expect(page.getByRole('status').filter({ hasText: 'Статусы сброшены: 8 игр' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Статус' }).getByRole('button', { name: /Не разобрано/ })).toContainText('10');
    await page.getByRole('button', { name: 'Вернуть', exact: true }).click();
    await expect.poll(() => mock.mutations.at(-1)?.url ?? '').toMatch(/\/api\/games\/status-restore$/);
    expect(mock.mutations.at(-1)?.body).toEqual({ backupId: 1 });
    await expect(page.getByRole('status').filter({ hasText: 'Статусы возвращены: 8 игр' })).toBeVisible();
    expect(mock.games.map((g) => ({ id: g.id, status: g.status, completedAt: g.completedAt, droppedAt: g.droppedAt }))).toEqual(before);
    await expect(page.getByRole('group', { name: 'Статус' }).getByRole('button', { name: /Пройдено/ })).toContainText('3');
  });

  test('вся коллекция: ошибка сервера остаётся в окне, статусы не тронуты', async ({ page, context, baseURL }, info) => {
    const mock = await openCollection(page, context, baseURL!);
    await collectionMenu(page, isMobile(info.project.name), /Сбросить все статусы/);
    const dlg = page.getByRole('dialog', { name: 'Сбросить все статусы' });
    await dlg.getByRole('textbox').fill('СБРОС');
    mock.failNextMutation = 503;
    await dlg.getByRole('button', { name: 'Сбросить статусы' }).click();
    await expect(dlg.getByRole('alert')).toContainText('Статусы не сброшены. База данных недоступна.');
    expect(mock.games.filter((g) => g.status).length).toBe(8);
    await dlg.getByRole('button', { name: 'Отмена' }).click();
    await expect(dlg).toHaveCount(0);
  });
});

test.describe('Фаза 8: скрытие игр', () => {
  test('убрать в окне игры, «Вернуть» из тоста; затем убрать снова и вернуть из «Скрытых»', async ({ page, context, baseURL }, info) => {
    const mock = await openCollection(page, context, baseURL!);
    const mobile = isMobile(info.project.name);
    await card(page, 'Tetris Effect').locator('.ps-card__hit').click();
    const dlg = page.getByRole('dialog', { name: 'Tetris Effect' });
    const hide = dlg.getByRole('button', { name: 'Убрать из коллекции' });
    await expect(hide).toHaveAccessibleDescription('Игра не будет показываться нигде, синк её не вернёт.');
    await hide.click();
    await expect(dlg).toHaveCount(0);
    expect(mock.mutations.at(-1)).toMatchObject({ method: 'PUT', body: { hidden: true } });
    expect(mock.mutations.at(-1)?.url).toMatch(/\/api\/games\/8\/hidden$/);
    await expect(card(page, 'Tetris Effect')).toHaveCount(0);
    await expect(page.locator('.ps-statline')).toContainText('9');
    // «Вернуть» в тосте
    await page.getByRole('button', { name: 'Вернуть', exact: true }).click();
    await expect(card(page, 'Tetris Effect')).toHaveCount(1);
    expect(mock.mutations.at(-1)?.body).toEqual({ hidden: false });

    // снова скрыть и вернуть через раздел «Скрытые»
    await card(page, 'Tetris Effect').locator('.ps-card__hit').click();
    await dlg.getByRole('button', { name: 'Убрать из коллекции' }).click();
    await expect(card(page, 'Tetris Effect')).toHaveCount(0);
    await collectionMenu(page, mobile, /Скрытые игры/);
    await expect(page).toHaveURL(/hidden=1/);
    await expect(coll(page).getByRole('heading', { name: 'Скрытые игры' })).toBeVisible();
    expect(mock.listCalls.at(-1)?.searchParams.get('hidden')).toBe('only');
    await expect(card(page, 'Tetris Effect')).toHaveCount(1);
    await expect(coll(page).locator('article.ps-card')).toHaveCount(1);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/p8-hidden-${info.project.name}.png`, fullPage: true });
    await card(page, 'Tetris Effect').getByRole('button', { name: 'Вернуть в коллекцию: Tetris Effect' }).click();
    expect(mock.mutations.at(-1)?.body).toEqual({ hidden: false });
    await expect(page.getByText('Скрытых игр нет')).toBeVisible();
    await page.getByRole('button', { name: 'К коллекции' }).click();
    await expect(page).not.toHaveURL(/hidden=1/);
    await expect(card(page, 'Tetris Effect')).toHaveCount(1);
  });

  test('возврат из окна игры в «Скрытых»', async ({ page, context, baseURL }) => {
    await login(context, baseURL!);
    const games = seed();
    games.find((g) => g.id === 9)!.hiddenAt = '2026-10-01T10:00:00.000Z';
    const mock = await mockApi(page, games);
    await page.goto('/?hidden=1');
    await expect(card(page, 'Gran Turismo 7')).toHaveCount(1);
    await card(page, 'Gran Turismo 7').locator('.ps-card__hit').click();
    const dlg = page.getByRole('dialog', { name: 'Gran Turismo 7' });
    await expect(dlg).toContainText('Убрана из коллекции');
    await dlg.getByRole('button', { name: 'Вернуть в коллекцию' }).click();
    await expect(dlg).toHaveCount(0);
    expect(mock.games.find((g) => g.id === 9)?.hiddenAt).toBeNull();
    await expect(page.getByText('Скрытых игр нет')).toBeVisible();
  });

  test('режим «Выбрать»: убрать выделенные (параллельные PUT), итог в тосте, «Вернуть»', async ({ page, context, baseURL }) => {
    const mock = await openCollection(page, context, baseURL!, '/?sort=title');
    await page.getByRole('button', { name: 'Выбрать' }).click();
    for (const t of ['Stray', 'Hades', 'Bloodborne']) await card(page, t).locator('.ps-card__hit').click();
    const bar = page.getByRole('region', { name: 'Выбор игр' });
    await expect(bar).toContainText('Выбрано 3');
    await bar.getByRole('button', { name: 'Убрать из коллекции' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Убрано из коллекции: 3 игры' })).toBeVisible();
    const puts = mock.mutations.filter((m) => /\/hidden$/.test(m.url));
    expect(puts.map((m) => Number(m.url.match(/games\/(\d+)\//)?.[1])).sort((a, b) => a - b)).toEqual([5, 6, 10]);
    expect(puts.every((m) => (m.body as { hidden: boolean }).hidden === true)).toBe(true);
    await expect(card(page, 'Stray')).toHaveCount(0);
    await expect(bar).toHaveCount(0);
    await page.getByRole('button', { name: 'Вернуть', exact: true }).click();
    await expect(card(page, 'Stray')).toHaveCount(1);
    expect(mock.games.filter((g) => g.hiddenAt).length).toBe(0);
  });

  test('режим «Выбрать» в «Скрытых»: только «Вернуть в коллекцию»', async ({ page, context, baseURL }) => {
    await login(context, baseURL!);
    const games = seed();
    for (const id of [6, 9]) games.find((g) => g.id === id)!.hiddenAt = '2026-10-01T10:00:00.000Z';
    const mock = await mockApi(page, games);
    await page.goto('/?hidden=1');
    await expect(coll(page).locator('article.ps-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'Выбрать' }).click();
    await page.getByRole('button', { name: 'Выбрать все (2)' }).click();
    const bar = page.getByRole('region', { name: 'Выбор игр' });
    await expect(bar.getByRole('button', { name: 'Поставить статус' })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Убрать из коллекции' })).toHaveCount(0);
    await bar.getByRole('button', { name: 'Вернуть в коллекцию' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Возвращено в коллекцию: 2 игры' })).toBeVisible();
    expect(mock.games.filter((g) => g.hiddenAt).length).toBe(0);
  });
});
