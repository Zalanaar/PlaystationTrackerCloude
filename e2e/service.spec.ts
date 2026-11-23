// Статус «Сервис» (игра-сервис): фильтр-чип, блок «Игры-сервисы», смена статуса, клавиша 6 в Разборе. API эмулируется (collection-mock.ts).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed, serviceGames, type G, type Mock } from './collection-mock';
import { signedSession } from './session';
import { searchBox } from './header-actions';

async function open(page: Page, context: BrowserContext, baseURL: string, url = '/', games: G[] = seed()): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, games);
  await page.goto(url);
  if (!url.startsWith('/triage')) {
    await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Статус' })).toBeVisible(); // скелет с h1 приходит раньше гидратации
  }
  return mock;
}

const coll = (page: Page) => page.locator('section[aria-labelledby="coll-title"]');
const block = (page: Page) => page.locator('#service');
const visibleCards = (page: Page) => block(page).locator('article.ps-card:visible');
const tab = (page: Page, name: RegExp) => page.getByRole('group', { name: 'Статус' }).getByRole('button', { name });
const toggle = (page: Page) => block(page).getByTestId('service-toggle');
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('блок «Игры-сервисы»', () => {
  test('нет игр-сервисов: блок, якорь и счётчик-ссылка скрыты; пустой чип «Сервис» тоже скрыт (Пакет 6, п. 5)', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await expect(block(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Игры-сервисы' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Сервисы' })).toHaveCount(0);
    await expect(tab(page, /Сервис/)).toHaveCount(0);
  });

  test('на главной сервисы в строке-ссылке, не отдельным блоком; в фильтре «Сервис» — сетка', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/', [...seed(), ...serviceGames(9)]);
    await expect(page.getByRole('heading', { name: 'Игры-сервисы' })).toHaveCount(0);
    await expect(block(page)).toHaveCount(0);
    const row = page.getByTestId('home-backlog-row');
    await expect(row).toHaveText(/Бэклог 1 · Отложено 1 · Сервисы 9/);
    await expect(row).toHaveAttribute('href', '/backlog');
    await expect(tab(page, /Сервис/)).toContainText('9');
    await expect(coll(page).locator('#y2026')).not.toContainText('Сервис 1');
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    await tab(page, /Сервис/).click();
    await expect(block(page)).toBeVisible();
    await expect(block(page).locator('.ps-block__cnt')).toHaveText('9');
    await expect(visibleCards(page)).toHaveCount(9);
    await expect(visibleCards(page).first().locator('.ps-card__title')).toHaveText('Сервис 1');
    await expect(toggle(page)).toHaveCount(0);
  });

  test('фильтр «Сервис»: две игры без кнопки «Показать ещё»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/?status=service', [...seed(), ...serviceGames(2)]);
    await expect(block(page)).toBeVisible();
    await expect(visibleCards(page)).toHaveCount(2);
    await expect(toggle(page)).toHaveCount(0);
  });

  test('строка ведёт в Бэклог; в фильтре «Сервис» на карточке ромб с подписью «Игра-сервис»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/', [...seed(), ...serviceGames(3)]);
    await expect(page.getByRole('navigation', { name: 'Годы и блоки' }).getByRole('link', { name: 'Сервисы' })).toHaveCount(0);
    await expect(page.getByTestId('home-backlog-row')).toHaveAttribute('href', '/backlog');
    await tab(page, /Сервис/).click();
    await expect(block(page)).toBeVisible();
    await expect(visibleCards(page).first().locator('.ps-card__glyph')).toHaveAttribute('title', 'Игра-сервис');
    await expect(visibleCards(page).first().locator('.ps-card__date')).toHaveCount(0);
  });

  test('чип «Сервис» показывает блок целиком, без кнопки; URL status=service; поиск скрывает блок без совпадений', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/', [...seed(), ...serviceGames(9)]);
    await tab(page, /Сервис/).click();
    await expect(page).toHaveURL(/status=service/);
    await expect(visibleCards(page)).toHaveCount(9);
    await expect(toggle(page)).toHaveCount(0);
    await expect(tab(page, /Сервис/)).toHaveAttribute('aria-pressed', 'true');
    await (await searchBox(page)).fill('witcher');
    await expect(page.getByText('Ничего не найдено')).toBeVisible();
    await expect(block(page)).toHaveCount(0);
  });

  test('режим «Список» и фильтр «Сервис»: все строки сразу, без «Показать ещё»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/?view=list&status=service', [...seed(), ...serviceGames(20)]);
    await expect(block(page).locator('.ps-row')).toHaveCount(20);
    await expect(toggle(page)).toHaveCount(0);
  });

  test('3 темы: строка на главной и блок в фильтре помещаются по ширине', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/', [...seed(), ...serviceGames(9)]);
    for (const th of ['night', 'graphite', 'ps5'] as const) {
      await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, th);
      expect(await overflow(page), th).toBeLessThanOrEqual(0);
    }
    await tab(page, /Сервис/).click();
    for (const th of ['night', 'graphite', 'ps5'] as const) {
      await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, th);
      expect(await overflow(page), th).toBeLessThanOrEqual(0);
      const c = await block(page).locator('.ps-block__head svg').evaluate((el) => getComputedStyle(el).color);
      expect(c, th).toBe('rgb(120, 180, 255)');
    }
  });
});

test.describe('смена статуса на «Сервис» (desktop)', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'десктопный сценарий'); });

  test('меню из 7 пунктов с подсказкой; Stray переезжает из бэклога в блок, счётчики меняются', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, '/?status=backlog');
    await coll(page).getByRole('button', { name: 'Статус: Stray' }).click();
    const items = page.getByRole('menuitemradio');
    await expect(items).toHaveText(['Играю', 'Пройдено', 'Бэклог', 'Брошено', 'Отложено', 'Сервис', 'Без статуса']);
    await expect(page.getByRole('menuitemradio', { name: 'Сервис' })).toHaveAttribute('title', 'Игра-сервис: вне хроники и бэклога');
    await page.getByRole('menuitemradio', { name: 'Сервис' }).click();
    await expect(page.getByText('Статус изменён: Сервис')).toBeVisible();
    expect(mock.mutations.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'service' } });
    await expect(tab(page, /Сервис/)).toContainText('1');
    await expect(tab(page, /Бэклог/)).toHaveCount(0); // Пакет 6, п. 5: пустой чип скрыт
    await tab(page, /^Все/).click();
    await expect(page.getByTestId('home-backlog-row')).toHaveText(/Сервисы 1/);
    await expect(block(page)).toHaveCount(0);
    await tab(page, /Сервис/).click();
    await expect(block(page)).toBeVisible();
    await expect(visibleCards(page)).toHaveCount(1);
    await expect(visibleCards(page).first()).toContainText('Stray');
    await page.reload();
    await expect(visibleCards(page).first()).toContainText('Stray');
  });

  test('пройденная игра со статусом «Сервис» уходит из хроники (даты нет)', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await expect(coll(page).locator('#y2026')).toContainText('God of War');
    await coll(page).getByRole('button', { name: 'Статус: God of War' }).click();
    await page.getByRole('menuitemradio', { name: 'Сервис' }).click();
    await expect(page.getByTestId('home-backlog-row')).toHaveText(/Сервисы 1/);
    await expect(coll(page).locator('#y2026')).not.toContainText('God of War');
    await tab(page, /Сервис/).click();
    await expect(block(page)).toContainText('God of War');
  });
});

test.describe('Разбор: клавиша 6 (desktop)', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'десктопный сценарий'); });
  test.use({ viewport: { width: 1440, height: 900 } });

  test('6 ставит «Сервис»; шестая строка-кнопка с ромбом', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, '/triage');
    await expect(page.getByRole('heading', { level: 2, name: 'Tetris Effect' })).toBeVisible();
    const keys = page.getByRole('group', { name: 'Статус игры' }).getByRole('button');
    await expect(keys).toHaveCount(6);
    await expect(keys.nth(5)).toContainText('Сервис');
    await expect(keys.nth(5)).toContainText('6');
    await page.keyboard.press('6');
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'service' } });
    await expect(page.getByRole('heading', { level: 2, name: 'Gran Turismo 7' })).toBeVisible();
  });
});

test.describe('Разбор на мобильном: «Сервис» только через меню', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'mobile', 'мобильный сценарий'); });

  test('5 кнопок, «Сервис» в меню статуса', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, '/triage');
    await expect(page.getByRole('group', { name: 'Статус игры' }).getByRole('button')).toHaveCount(5);
    await page.getByRole('button', { name: 'Другой статус' }).click();
    await expect(page.getByRole('menuitemradio')).toHaveText([/Играю/, /Пройдено/, /Бэклог/, /Брошено/, /Отложено/, /Сервис/]);
    await expect(page.getByText('Игра-сервис: вне хроники и бэклога')).toBeVisible();
    await page.getByRole('menuitemradio', { name: /Сервис/ }).click();
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'service' } });
  });
});
