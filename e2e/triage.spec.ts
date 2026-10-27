// «Разбор» (/triage) и «Бэклог» (/backlog). API эмулируется (e2e/collection-mock.ts).
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed, type Mock } from './collection-mock';
import { signedSession } from './session';

async function open(page: Page, context: import('@playwright/test').BrowserContext, baseURL: string, url: string, games = seed()): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, games);
  await page.goto(url);
  return mock;
}

test.describe('Разбор (desktop)', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'десктопный сценарий'); });
  test.use({ viewport: { width: 1440, height: 900 } });

  test('клавиша 2 ставит «пройдено», прогресс и очередь двигаются, Z отменяет', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, '/triage');
    // очередь по последнему запуску: Tetris Effect (25 окт.), затем Gran Turismo 7 (без запусков)
    await expect(page.getByRole('heading', { level: 2, name: 'Tetris Effect' })).toBeVisible();
    await expect(page.locator('.ps-tri__pos')).toHaveText('8 / 10');
    await expect(page.getByText('осталось 2')).toBeVisible();
    await page.keyboard.press('2');
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'completed' } });
    expect(mock.mutations.at(-1)!.url).toMatch(/\/api\/games\/8\/status$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Gran Turismo 7' })).toBeVisible();
    await expect(page.getByText('осталось 1')).toBeVisible();
    // отмена: игра возвращается, PUT с null
    await page.keyboard.press('z');
    await expect(page.getByRole('heading', { level: 2, name: 'Tetris Effect' })).toBeVisible();
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ method: 'PUT', body: { status: null } });
    await expect(page.getByText('осталось 2')).toBeVisible();
  });

  test('кнопки статусов, пропуск пробелом, финал «Всё разобрано»', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, '/triage');
    await expect(page.getByRole('heading', { level: 2, name: 'Tetris Effect' })).toBeVisible();
    await page.keyboard.press(' ');
    await expect(page.getByRole('heading', { level: 2, name: 'Gran Turismo 7' })).toBeVisible();
    await page.getByRole('button', { name: /Брошено/ }).click();
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ body: { status: 'dropped' } });
    await expect(page.getByRole('heading', { level: 2, name: 'Tetris Effect' })).toBeVisible();
    await page.keyboard.press('3');
    await expect(page.getByRole('heading', { name: 'Всё разобрано' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'К коллекции' })).toHaveAttribute('href', '/');
    await expect(page.getByLabel('Итог разбора')).toContainText('Брошено');
    await expect(page.getByLabel('Итог разбора')).toContainText('Бэклог');
  });

  test('ошибка PUT возвращает игру в очередь с сообщением', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, '/triage');
    await expect(page.getByRole('heading', { level: 2, name: 'Tetris Effect' })).toBeVisible();
    mock.failNextMutation = 503;
    await page.keyboard.press('1');
    await expect(page.getByText(/Не удалось сменить статус/)).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Tetris Effect' })).toBeVisible();
  });

  test('Esc выходит в коллекцию, вход из блока «Не разобрано»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/triage');
    await expect(page.getByRole('heading', { level: 2, name: 'Tetris Effect' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole('link', { name: 'Разобрать по одной' }).click();
    await expect(page).toHaveURL(/\/triage$/);
  });

  test('пустое состояние: все игры со статусом', async ({ page, context, baseURL }) => {
    const games = seed().map((g) => ({ ...g, status: g.status ?? 'backlog' as const }));
    await open(page, context, baseURL!, '/triage', games);
    await expect(page.getByRole('heading', { name: 'Всё разобрано' })).toBeVisible();
  });
});

test.describe('Разбор (мобильный)', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'mobile', 'мобильный сценарий'); });

  test('кнопки и свайп вправо = пройдено, без горизонтального скролла', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, '/triage');
    await expect(page.locator('.ps-stack3__top').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.getByRole('group', { name: 'Статус игры' }).getByRole('button')).toHaveCount(5);
    const card = page.locator('.ps-stack3__top').first();
    const b = (await card.boundingBox())!;
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + 40, y);
    await page.mouse.down();
    await page.mouse.move(b.x + 120, y, { steps: 4 });
    await page.mouse.move(b.x + b.width - 20, y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ body: { status: 'completed' } });
    // слабый свайп ничего не меняет
    const n = mock.mutations.length;
    const c2 = (await page.locator('.ps-stack3__top').first().boundingBox())!;
    await page.mouse.move(c2.x + 100, c2.y + 200);
    await page.mouse.down();
    await page.mouse.move(c2.x + 130, c2.y + 200, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect(mock.mutations.length).toBe(n);
    // кнопка «Бэклог»
    await page.getByRole('group', { name: 'Статус игры' }).getByRole('button', { name: 'Бэклог' }).click();
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ body: { status: 'backlog' } });
  });
});

test.describe('Бэклог (/backlog)', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'не зависит от вьюпорта'); });

  test('список игр бэклога, «Начать играть» убирает игру сразу', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, '/backlog');
    await expect(page.getByRole('heading', { level: 1, name: 'Бэклог' })).toBeVisible();
    await expect(page.locator('.ps-card__title')).toHaveText(['Stray']);
    await page.getByRole('button', { name: 'Начать играть' }).click();
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'playing' } });
    await expect(page.getByText('Бэклог пуст')).toBeVisible();
    await expect(page.getByText('Статус изменён: Играю')).toBeVisible();
    // в коллекции игра теперь в ленте «Играю»
    await page.getByRole('link', { name: 'К коллекции' }).click();
    await expect(page.getByRole('region', { name: 'Играю' })).toContainText('Stray');
  });

  test('«Убрать из бэклога» сбрасывает статус, «Отменить» возвращает', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, '/backlog');
    await page.getByRole('button', { name: 'Убрать из бэклога' }).click();
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ body: { status: null } });
    await expect(page.getByText('Бэклог пуст')).toBeVisible();
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.locator('.ps-card__title')).toHaveText(['Stray']);
    expect(mock.mutations.at(-1)).toMatchObject({ body: { status: 'backlog' } });
  });

  test('сбой смены статуса возвращает игру в список', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, '/backlog');
    mock.failNextMutation = 503;
    await page.getByRole('button', { name: 'Начать играть' }).click();
    await expect(page.getByText(/Не удалось сменить статус/)).toBeVisible();
    await expect(page.locator('.ps-card__title')).toHaveText(['Stray']);
  });

  test('пустой бэклог', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/backlog', seed().map((g) => (g.status === 'backlog' ? { ...g, status: null } : g)));
    await expect(page.getByText('Бэклог пуст')).toBeVisible();
    await expect(page.getByText('Поставь играм статус «Бэклог» в коллекции')).toBeVisible();
  });
});
