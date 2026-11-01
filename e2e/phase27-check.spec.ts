// Фаза 27: очередь «Проверить» (/triage?mode=check), design-system §13. API эмулируется (e2e/collection-mock.ts).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed, type HintMock, type Mock } from './collection-mock';
import { signedSession } from './session';

// Stray (6, бэклог), Horizon (3, играю, stale), Tetris Effect (8, без статуса)
const HINTS: HintMock[] = [
  { gameId: 6, rule: 'started', currentStatus: 'backlog', facts: { statusChangedAt: '2026-08-01T10:00:00.000Z' } },
  { gameId: 3, rule: 'stale', currentStatus: 'playing', facts: { daysSinceLaunch: 42 } },
  { gameId: 8, rule: 'started', currentStatus: null },
];

async function open(page: Page, context: BrowserContext, baseURL: string, hints: HintMock[] = HINTS, url = '/triage?mode=check'): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, seed());
  mock.hints = hints;
  await page.goto(url);
  if (url.startsWith('/triage')) await page.locator('.ps-tri__pos').or(page.getByRole('heading', { name: 'Подсказок нет' })).waitFor();
  return mock;
}
const title = (page: Page, name: string) => page.getByRole('heading', { level: 2, name });

test.describe('Проверить (desktop)', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'десктопный сценарий'); });
  test.use({ viewport: { width: 1440, height: 900 } });

  test('текст подсказки, цель и текущий статус на клавишах, сегмент режима', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await expect(title(page, 'Stray')).toBeVisible();
    await expect(page.locator('.ps-tri__pos')).toHaveText('0 / 3');
    const sg = page.getByRole('group', { name: 'Подсказка' });
    await expect(sg).toContainText('Играю?');
    await expect(sg).toContainText('Статус не изменится, пока ты не выберешь');
    await expect(sg.locator('.ps-sg__why')).toContainText('«Бэклог»');
    await expect(page.getByRole('button', { name: 'Принять: Играю' })).toBeVisible();
    // Бэклог = текущий, Играю = цель
    await expect(page.locator('.ps-key[data-status="backlog"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('.ps-key[data-status="playing"]')).toHaveAttribute('data-target', 'true');
    await expect(page.getByRole('group', { name: 'Какие игры разбирать' }).getByRole('button', { name: 'Проверить 3' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('Enter принимает: PUT status, тост, счётчик; Z откатывает', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    await page.keyboard.press('Enter');
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'playing' } });
    expect(mock.mutations.at(-1)!.url).toMatch(/\/api\/games\/6\/status$/);
    await expect(page.getByText('Статус изменён: Играю')).toBeVisible();
    await expect(title(page, 'Horizon Forbidden West')).toBeVisible();
    await expect(page.locator('.ps-tri__pos')).toHaveText('1 / 3');
    await expect(page.getByText('осталось 2')).toBeVisible();
    await page.keyboard.press('z');
    await expect(title(page, 'Stray')).toBeVisible();
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'backlog' } });
  });

  const RETURNED: HintMock[] = [
    { gameId: 5, rule: 'returned', currentStatus: 'dropped', facts: { statusChangedAt: '2026-01-02T09:00:00.000Z' } },
    { gameId: 3, rule: 'stale', currentStatus: 'playing', facts: { daysSinceLaunch: 42 } },
    { gameId: 8, rule: 'started', currentStatus: null },
  ];

  test('QA-27-1: откат «Принять» шлёт restore из снимка ДО принятия и expectedStatus = принятая цель', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, RETURNED);
    await page.keyboard.press('Enter');
    await expect.poll(() => mock.mutations.length).toBe(1);
    expect(mock.mutations[0].body).toEqual({ status: 'playing', expectedStatus: 'dropped' });
    await page.keyboard.press('z');
    await expect.poll(() => mock.mutations.length).toBe(2);
    expect(mock.mutations[1].body).toEqual({
      status: 'dropped', expectedStatus: 'playing',
      restore: { status: 'dropped', statusChangedAt: '2026-01-02T09:00:00.000Z', completedAt: null, droppedAt: '2025-12-31T21:30:00.000Z' },
    });
    // даты в «БД» мока восстановлены, а не пересчитаны
    expect(mock.games.find((g) => g.id === 5)).toMatchObject({ status: 'dropped', droppedAt: '2025-12-31T21:30:00.000Z' });
    await expect(title(page, 'Hades')).toBeVisible();
  });

  test('QA-27-1: без прошлого статуса откат = {status:null} без restore', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, [HINTS[2], HINTS[0]]);
    await page.keyboard.press('Enter');
    await expect.poll(() => mock.mutations.length).toBe(1);
    expect(mock.mutations[0].body).toEqual({ status: 'playing', expectedStatus: null });
    await page.keyboard.press('z');
    await expect.poll(() => mock.mutations.length).toBe(2);
    expect(mock.mutations[1].body).toEqual({ status: null, expectedStatus: 'playing' });
  });

  test('QA-27-3: 409 убирает карточку, счётчик не откатывается, warning-тост без «Отменить», «Обновить подсказку» перезагружает очередь', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    (mock.games.find((g) => g.id === 6) as { status: string }).status = 'shelved'; // статус сменили в другом месте
    await page.keyboard.press('Enter');
    const toast = page.locator('.ps-toast', { hasText: 'Статус уже изменён в другом месте. Подсказка могла устареть.' });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute('data-kind', 'warning');
    await expect(toast.getByRole('button', { name: 'Отменить' })).toHaveCount(0);
    await expect(page.locator('.ps-toast', { hasText: 'Статус изменён: Играю' })).toHaveCount(0);
    await expect(title(page, 'Horizon Forbidden West')).toBeVisible();
    await expect(page.locator('.ps-tri__pos')).toHaveText('1 / 3');
    // Z не откатывает конфликтную запись и ничего не шлёт
    const n = mock.mutations.length;
    await page.keyboard.press('z');
    await page.waitForTimeout(150);
    expect(mock.mutations.length).toBe(n);
    await toast.getByRole('button', { name: 'Обновить подсказку' }).click();
    await expect(title(page, 'Stray')).toBeVisible();
    await expect(page.locator('.ps-tri__pos')).toHaveText('0 / 3');
    await expect(page).toHaveURL(/mode=check/);
  });

  test('QA-27-3: игра удалена (404) = «Игра не найдена», счётчик уменьшается', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    mock.games = mock.games.filter((g) => g.id !== 6);
    await page.keyboard.press('Enter');
    await expect(page.getByText('Игра не найдена, подсказка убрана')).toBeVisible();
    await expect(page.locator('.ps-toast', { hasText: 'Подсказка могла устареть' })).toHaveCount(0);
  });

  test('QA-27-2: тост заменяется новым, «Отменить» и Z откатывают своё действие', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    await page.keyboard.press('Enter'); // принять Stray
    await expect(page.getByText('Статус изменён: Играю')).toBeVisible();
    await page.keyboard.press('n'); // не предлагать Horizon
    await expect(page.getByText('Не предлагаем «Отложить / бросить?» для «Horizon Forbidden West»')).toBeVisible();
    // прежний тост заменён: «Отменить» осталась только у последнего
    await expect(page.getByText('Статус изменён: Играю')).toHaveCount(0);
    await expect(page.locator('.ps-toast__action')).toHaveCount(1);
    await expect.poll(() => mock.dismissals.length).toBe(1);
    await page.locator('.ps-toast__action').click();
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ method: 'DELETE' });
    expect(mock.mutations.at(-1)!.url).toMatch(/dismissals\/3\/stale$/);
    await expect(title(page, 'Horizon Forbidden West')).toBeVisible();
    // статус Stray остался принятым: PUT отката не было
    expect(mock.mutations.filter((x) => x.method === 'PUT')).toHaveLength(1);
    // Z откатывает предыдущее действие (принять Stray)
    await page.keyboard.press('z');
    await expect.poll(() => mock.mutations.filter((x) => x.method === 'PUT').length).toBe(2);
    expect(mock.mutations.at(-1)!.url).toMatch(/games\/6\/status$/);
  });

  test('QA-27-2: Z закрывает тост откатанного действия, повторный клик по нему не нужен', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    await page.keyboard.press('n');
    const t = page.locator('.ps-toast', { hasText: 'Не предлагаем' });
    await expect(t).toBeVisible();
    await page.keyboard.press('z');
    await expect(t).toHaveCount(0);
    await expect.poll(() => mock.mutations.filter((x) => x.method === 'DELETE').length).toBe(1);
    await page.waitForTimeout(150);
    expect(mock.mutations.filter((x) => x.method === 'DELETE')).toHaveLength(1);
  });

  test('QA-27-4: platinum: подпись «дата завершения — последний запуск» на кнопке и строке, дата платины только в причине', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, [
      { gameId: 3, rule: 'platinum', currentStatus: 'playing', facts: { platinumEarnedAt: '2026-10-12T10:00:00.000Z' } },
      { gameId: 9, rule: 'platinum', currentStatus: null, facts: { platinumEarnedAt: '2026-10-12T10:00:00.000Z' } },
    ]);
    const note = 'дата завершения — последний запуск: 20.10';
    await expect(page.getByRole('button', { name: 'Принять: Пройдено' })).toContainText(note);
    await expect(page.locator('.ps-key[data-status="completed"] .ps-key__h, .ps-key[data-status="completed"]').first()).toContainText(/предлагаем|последний запуск/);
    await expect(page.locator('.ps-sg__why')).toContainText('12 окт.');
    await expect(page.getByText(note)).toHaveCount(1);
    await page.keyboard.press('0');
    // игра без lastPlayedAt: подписи с датой нет
    await expect(title(page, 'Gran Turismo 7')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Принять: Пройдено' })).not.toContainText('последний запуск');
    await expect(page.locator('.ps-sg__why')).toContainText('12 окт.');
  });

  test('«Оставить как есть» (0, Пробел, →) ничего не пишет на сервер', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    await page.keyboard.press('0');
    await expect(title(page, 'Horizon Forbidden West')).toBeVisible();
    await page.keyboard.press(' ');
    await expect(title(page, 'Tetris Effect')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('heading', { name: 'Всё проверено' })).toBeVisible();
    expect(mock.mutations).toHaveLength(0);
    await expect(page.getByLabel('Итог проверки')).toContainText('Оставлено 3');
  });

  test('«Не предлагать» пишет отказ, Z и «Отменить» в тосте снимают его', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    await page.keyboard.press('n');
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ method: 'POST', body: { gameId: 6, rule: 'started' } });
    await expect(page.getByText('Не предлагаем «Играю?» для «Stray»')).toBeVisible();
    await expect(title(page, 'Horizon Forbidden West')).toBeVisible();
    expect(mock.dismissals).toHaveLength(1);
    await page.keyboard.press('z');
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ method: 'DELETE' });
    expect(mock.mutations.at(-1)!.url).toMatch(/dismissals\/6\/started$/);
    await expect(title(page, 'Stray')).toBeVisible();
    expect(mock.dismissals).toHaveLength(0);
    // кнопка «Отменить» в тосте
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Т', bubbles: true }))); // рус. раскладка
    await expect(page.getByText('Не предлагаем «Играю?» для «Stray»').last()).toBeVisible();
    await page.locator('.ps-toast', { hasText: 'Не предлагаем' }).last().locator('.ps-toast__action').click();
    await expect.poll(() => mock.dismissals.length).toBe(0);
    await expect(title(page, 'Stray')).toBeVisible();
  });

  test('stale: две цели, 5 = «Отложено», 4 = «Брошено»', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, [HINTS[1], { ...HINTS[1], gameId: 7, rule: 'stale', currentStatus: 'shelved' }]);
    await expect(page.getByRole('button', { name: 'Отложить', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Бросить', exact: true })).toBeVisible();
    await expect(page.locator('.ps-key[data-target="true"]')).toHaveCount(2);
    await expect(page.locator('.ps-key[data-status="playing"]')).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Enter');
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ body: { status: 'shelved' } });
    await page.keyboard.press('4');
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ body: { status: 'dropped' } });
    expect(mock.mutations.at(-1)!.url).toMatch(/\/games\/7\/status$/);
  });

  test('нажатие на текущий статус ничего не делает', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    await page.keyboard.press('3');
    await page.waitForTimeout(150);
    expect(mock.mutations).toHaveLength(0);
    await expect(title(page, 'Stray')).toBeVisible();
  });

  test('ошибка PUT возвращает карточку, ошибка отказа даёт «Повторить»', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    mock.failNextMutation = 503;
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Не удалось сменить статус/)).toBeVisible();
    await expect(title(page, 'Stray')).toBeVisible();
    await expect(page.locator('.ps-tri__pos')).toHaveText('0 / 3');
    mock.failNextMutation = 503;
    await page.keyboard.press('n');
    await expect(page.getByText('Не удалось сохранить отказ. Повтори')).toBeVisible();
    await expect(title(page, 'Stray')).toBeVisible();
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect.poll(() => mock.dismissals.length).toBe(1);
  });

  test('пусто: «Подсказок нет», ошибка загрузки с «Повторить», переключение режима', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, []);
    await expect(page.getByRole('heading', { name: 'Подсказок нет' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'К разбору' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'К коллекции' })).toHaveAttribute('href', '/');
    await page.getByRole('button', { name: 'К разбору' }).click();
    await expect(page).toHaveURL(/\/triage$/);
  });

  test('ошибка загрузки и повтор', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    const mock = await mockApi(page, seed());
    mock.hints = HINTS;
    mock.hintsFail = 503;
    await page.goto('/triage?mode=check');
    await expect(page.getByRole('alert').getByText('Не удалось загрузить подсказки')).toBeVisible();
    mock.hintsFail = null;
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(title(page, 'Stray')).toBeVisible();
  });

  test('сегмент «Проверить» переключает режим и перезапускает очередь, чип в Коллекции ведёт сюда', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, HINTS, '/');
    const chip = page.getByTestId('check-chip').first();
    await expect(chip).toHaveText('Проверить статусы: 3');
    await chip.click();
    await expect(page).toHaveURL(/mode=check/);
    await expect(title(page, 'Stray')).toBeVisible();
    await page.keyboard.press('0');
    await page.getByRole('group', { name: 'Какие игры разбирать' }).getByRole('button', { name: /^Все/ }).click();
    await expect(page).toHaveURL(/\/triage$/);
    await page.getByRole('group', { name: 'Какие игры разбирать' }).getByRole('button', { name: /^Проверить/ }).click();
    await expect(title(page, 'Stray')).toBeVisible();
    await expect(page.locator('.ps-tri__pos')).toHaveText('0 / 3');
  });

  test('без подсказок чип не показывается', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    await mockApi(page, seed());
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('check-chip')).toHaveCount(0);
  });
});

test.describe('Проверить (мобильный 360x640)', () => {
  test.use({ viewport: { width: 360, height: 640 } });
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'mobile', 'мобильный сценарий'); });

  const drag = async (page: Page, dx: number, dy: number) => {
    const b = (await page.locator('.ps-stack3__top').first().boundingBox())!;
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
    await page.mouse.move(x + dx, y + dy, { steps: 4 });
    await page.mouse.up();
  };

  test('«Принять» видна без прокрутки, нет горизонтального скролла', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    const accept = page.getByRole('button', { name: 'Принять: Играю' });
    await expect(accept).toBeVisible();
    const box = (await accept.boundingBox())!;
    // не под tab bar
    const tab = (await page.locator('.ps-tabbar').boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(tab.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.getByRole('button', { name: 'Не предлагать для этой игры' })).toBeAttached();
  });

  test('свайп вправо принимает, влево оставляет, вверх и вниз не делают ничего', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    await drag(page, 0, -200);
    await drag(page, 0, 200);
    await page.waitForTimeout(200);
    expect(mock.mutations).toHaveLength(0);
    await expect(page.locator('.ps-tri__pos')).toHaveText('0 / 3');
    await drag(page, 250, 0);
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'playing' } });
    await expect(page.locator('.ps-tri__pos')).toHaveText('1 / 3');
    const n = mock.mutations.length;
    await drag(page, -250, 0);
    await expect(page.locator('.ps-tri__pos')).toHaveText('2 / 3');
    expect(mock.mutations.length).toBe(n);
  });

  test('кнопки: принять, оставить, не предлагать; stale = две кнопки', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    await page.getByRole('button', { name: 'Не предлагать для этой игры' }).click();
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ method: 'POST', body: { gameId: 6, rule: 'started' } });
    await expect(page.getByRole('button', { name: 'Отложить', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Бросить', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Оставить как есть' })).toBeVisible();
    await page.getByRole('button', { name: 'Бросить', exact: true }).click();
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'dropped' } });
  });

  test('320: нет горизонтального скролла', async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page, context, baseURL!);
    await expect(page.getByRole('button', { name: 'Принять: Играю' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
