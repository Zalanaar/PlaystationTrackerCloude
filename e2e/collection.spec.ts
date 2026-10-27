// Приёмка Фазы 3: коллекция. API эмулируется внутри теста (e2e/collection-mock.ts), БД не нужна.
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed, type Mock } from './collection-mock';
import { signedSession } from './session';

async function open(page: Page, context: import('@playwright/test').BrowserContext, baseURL: string, url = '/', games = seed()): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, games);
  await page.goto(url);
  await expect(page.locator('section[aria-labelledby="coll-title"] .ps-count')).toBeVisible();
  return mock;
}

const coll = (page: Page) => page.locator('section[aria-labelledby="coll-title"]');
const cards = (page: Page) => coll(page).locator('article.ps-card');
const titles = async (page: Page) => (await cards(page).locator('.ps-card__title').allTextContents()).sort();
const tab = (page: Page, name: RegExp) => page.getByRole('group', { name: 'Статус' }).getByRole('button', { name });

test.describe('коллекция (desktop)', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'десктопный сценарий'); });

  test('по умолчанию: тема Night, все игры, счётчики табов', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    await expect(cards(page)).toHaveCount(10);
    await expect(tab(page, /^Все/)).toContainText('10');
    await expect(tab(page, /Пройдено/)).toContainText('3');
    await expect(tab(page, /Брошено/)).toContainText('2');
    await expect(tab(page, /Без статуса/)).toContainText('2');
  });

  test('статус-табы фильтруют, URL отражает фильтр, "Все" сбрасывает', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    await tab(page, /Пройдено/).click();
    await expect(page).toHaveURL(/status=completed/);
    await expect(tab(page, /Пройдено/)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => titles(page)).toEqual(['God of War', 'The Witcher 3: Wild Hunt', 'Ведьмак 3: Дикая Охота']);
    await expect.poll(() => mock.listCalls.at(-1)?.searchParams.get('status')).toBe('completed');

    await tab(page, /Без статуса/).click();
    await expect.poll(() => titles(page)).toEqual(['Gran Turismo 7', 'Tetris Effect']);

    await tab(page, /^Все/).click();
    await expect(cards(page)).toHaveCount(10);
    await expect(page).not.toHaveURL(/status=/);
  });

  test('фильтр по статусу открывается по прямой ссылке и переживает reload', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/?status=backlog&view=list');
    await expect(tab(page, /Бэклог/)).toHaveAttribute('aria-pressed', 'true');
    await expect(coll(page).locator('.ps-row__title', { hasText: 'Stray' })).toBeVisible();
    await page.reload();
    await expect(tab(page, /Бэклог/)).toHaveAttribute('aria-pressed', 'true');
    await expect(coll(page).locator('.ps-row__title', { hasText: 'Stray' })).toBeVisible();
  });

  test('год = дата завершения: playing/backlog/shelved/без статуса скрыты, граница года по Москве', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    const year = coll(page).getByLabel('Год завершения');
    // список лет: 2026 (God of War + Hades 00:30 МСК 1 января), 2025, 2024
    await expect(year.locator('option')).toHaveText(['Все годы', '2026', '2025', '2024']);
    await year.selectOption('2026');
    await expect(page).toHaveURL(/year=2026/);
    await expect(coll(page).getByRole('note')).toContainText('Год считается по дате завершения');
    await expect.poll(() => titles(page)).toEqual(['God of War', 'Hades']);
    await expect.poll(() => mock.listCalls.at(-1)?.searchParams.get('year')).toBe('2026');
    // не показаны: Horizon (playing), Stray (backlog), Cyberpunk (shelved), Tetris/GT7 (без статуса)
    for (const t of ['Horizon Forbidden West', 'Stray', 'Cyberpunk 2077', 'Tetris Effect', 'Gran Turismo 7']) {
      await expect(coll(page).getByText(t, { exact: true })).toHaveCount(0);
    }
    await year.selectOption('2025');
    await expect.poll(() => titles(page)).toEqual(['Bloodborne', 'The Witcher 3: Wild Hunt']);
    // счётчики табов учитывают год
    await expect(tab(page, /Играю/)).toContainText('0');
    await expect(tab(page, /^Все/)).toContainText('2');
  });

  test('год + таб без совпадений: пустое состояние со сбросом', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/?year=2026&status=backlog');
    await expect(page.getByText('Ничего не найдено')).toBeVisible();
    await expect(page.getByText('За 2026 год нет завершённых или брошенных игр')).toBeVisible();
    await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
    await expect(cards(page)).toHaveCount(10);
    await expect(page).not.toHaveURL(/year=|status=/);
  });

  test('поиск: debounce, регистр, кириллица, пустой результат, очистка', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    const before = mock.listCalls.length;
    const input = page.getByRole('searchbox', { name: 'Поиск игры' });
    await input.pressSequentially('ведьм', { delay: 30 });
    await expect(page).toHaveURL(/q=%D0%B2%D0%B5%D0%B4%D1%8C%D0%BC|q=ведьм/);
    await expect.poll(() => titles(page)).toEqual(['Ведьмак 3: Дикая Охота']);
    // быстрый набор не породил запрос на каждую букву
    expect(mock.listCalls.length - before).toBeLessThanOrEqual(2);

    await input.fill('WITCHER');
    await expect.poll(() => titles(page)).toEqual(['The Witcher 3: Wild Hunt']);

    await input.fill('zzzz-нет');
    await expect(page.getByText('Ничего не найдено')).toBeVisible();
    await page.getByRole('button', { name: 'Очистить поиск' }).click();
    await expect(cards(page)).toHaveCount(10);
    await expect(input).toBeFocused();
  });

  test('поиск "/" фокусирует поле; поиск + таб + год комбинируются', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox', { name: 'Поиск игры' })).toBeFocused();
    await page.keyboard.type('witcher');
    await tab(page, /Пройдено/).click();
    await coll(page).getByLabel('Год завершения').selectOption('2025');
    await expect.poll(() => titles(page)).toEqual(['The Witcher 3: Wild Hunt']);
  });

  test('гонка фильтров: поздний ответ устаревшего запроса не затирает свежий', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    // первый запрос (Пройдено) отвечает медленно, второй (Бэклог) быстро
    mock.delayList = (u) => (u.searchParams.get('status') === 'completed' ? 1200 : 0);
    await tab(page, /Пройдено/).click();
    await tab(page, /Бэклог/).click();
    await expect(coll(page).locator('.ps-card__title, .ps-row__title').getByText('Stray', { exact: true })).toBeVisible();
    await page.waitForTimeout(1600);
    await expect.poll(() => titles(page)).toEqual(['Stray']);
    await expect(tab(page, /Бэклог/)).toHaveAttribute('aria-pressed', 'true');
  });

  test('сбой списка: ошибка с кнопкой, повтор после восстановления', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    mock.listFails = true;
    await tab(page, /Играю/).click();
    // старые данные остаются, показана строка об ошибке
    await expect(page.getByText('Не удалось обновить список')).toBeVisible();
    mock.listFails = false;
    await page.getByRole('button', { name: 'Повторить' }).first().click();
    await expect(page.getByText('Не удалось обновить список')).toHaveCount(0);
    await expect.poll(() => titles(page)).toEqual(['Horizon Forbidden West']);
  });

  test('смена статуса: меню карточки, счётчики, toast, сохранение после reload', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    await coll(page).getByRole('button', { name: 'Статус: Stray' }).click();
    await page.getByRole('menuitemradio', { name: 'Играю' }).click();
    await expect(page.getByText('Статус изменён: Играю')).toBeVisible();
    expect(mock.mutations.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'playing' } });
    await expect(tab(page, /Играю/)).toContainText('2');
    await expect(tab(page, /Бэклог/)).toContainText('0');
    await page.reload();
    await expect(tab(page, /Играю/)).toContainText('2');
    await tab(page, /Играю/).click();
    await expect.poll(() => titles(page)).toEqual(['Horizon Forbidden West', 'Stray']);
  });

  test('смена статуса на completed ставит дату = последний запуск, плашка "Завершено"', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await coll(page).getByRole('button', { name: 'Статус: Tetris Effect' }).click();
    await page.getByRole('menuitemradio', { name: 'Пройдено' }).click();
    const card = cards(page).filter({ hasText: 'Tetris Effect' });
    await expect(card.locator('.ps-card__plaque')).toHaveText('Завершено · 25.10.2026');
  });

  test('в отфильтрованном табе игра исчезает после смены статуса, "Отменить" возвращает', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/?status=backlog');
    await expect(cards(page)).toHaveCount(1);
    await coll(page).getByRole('button', { name: 'Статус: Stray' }).click();
    await page.getByRole('menuitemradio', { name: 'Брошено' }).click();
    await expect(page.getByText('Статус изменён: Брошено')).toBeVisible();
    await expect(page.getByText('Ничего не найдено')).toBeVisible();
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByText('Статус возвращён')).toBeVisible();
    await expect(cards(page)).toHaveCount(1);
  });

  test('сбой смены статуса откатывает оптимистичное изменение и счётчики', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    mock.failNextMutation = 503;
    await coll(page).getByRole('button', { name: 'Статус: Stray' }).click();
    await page.getByRole('menuitemradio', { name: 'Играю' }).click();
    await expect(page.getByText(/Не удалось сменить статус/)).toBeVisible();
    await expect(tab(page, /Бэклог/)).toContainText('1');
    await expect(tab(page, /Играю/)).toContainText('1');
    await expect(cards(page).filter({ hasText: 'Stray' }).locator('[data-status]').first()).toHaveAttribute('data-status', 'backlog');
  });

  test('сетевой обрыв при смене статуса: откат, список не залипает', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    mock.abortMutations = true;
    await coll(page).getByRole('button', { name: 'Статус: Stray' }).click();
    await page.getByRole('menuitemradio', { name: 'Играю' }).click();
    await expect(page.getByText(/Нет связи с сервером/)).toBeVisible();
    await expect(tab(page, /Бэклог/)).toContainText('1');
  });

  test('правка даты завершения из диалога двигает игру между годами', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, '/?year=2025');
    await expect(coll(page).locator('.ps-card__title, .ps-row__title').getByText('Bloodborne', { exact: true })).toBeVisible();
    await coll(page).getByRole('button', { name: 'Открыть: Bloodborne' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Изменить', exact: true }).click();
    await dlg.getByLabel('Дата завершения').fill('2024-01-15');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ method: 'PATCH', body: { droppedAt: '2024-01-15T09:00:00.000Z' } });
    await page.keyboard.press('Escape');
    await expect(coll(page).locator('.ps-card__title, .ps-row__title').getByText('Bloodborne', { exact: true })).toHaveCount(0);
  });

  // ЗАМЕЧАНИЕ (BUG-3): "Отменить" возвращает статус через PUT, сервер заново берёт last_played_at,
  // ручная дата теряется. Тест фиксирует желаемое поведение и ожидаемо падает до исправления.
  test('"Отменить" не должен терять вручную поправленную дату завершения', async ({ page, context, baseURL }) => {
    const games = seed();
    games[0].completedAt = '2025-04-01T09:00:00.000Z'; // вручную позже last_played_at
    await open(page, context, baseURL!, '/?status=completed', games);
    await expect(cards(page).filter({ hasText: 'The Witcher 3' }).locator('.ps-card__plaque')).toHaveText('Завершено · 01.04.2025');
    await coll(page).getByRole('button', { name: 'Статус: The Witcher 3: Wild Hunt' }).click();
    await page.getByRole('menuitemradio', { name: 'Бэклог' }).click();
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByText('Статус возвращён')).toBeVisible();
    await expect(cards(page).filter({ hasText: 'The Witcher 3' }).locator('.ps-card__plaque')).toHaveText('Завершено · 01.04.2025');
  });

  test('массовая смена статуса: выбор, bulk-запрос, сброс режима; сбой откатывает всё', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, '/?status=none');
    await page.getByRole('button', { name: 'Выбрать' }).click();
    await page.getByRole('button', { name: 'Выбрать все (2)' }).click();
    await expect(page.getByText('Выбрано 2')).toBeVisible();
    // сбой: ничего не должно измениться
    mock.failNextMutation = 503;
    await page.getByRole('button', { name: 'Поставить статус' }).click();
    await page.getByRole('menuitemradio', { name: 'Бэклог' }).click();
    await expect(page.getByText(/Массовая смена не выполнена, ничего не изменено/)).toBeVisible();
    await expect(tab(page, /Без статуса/)).toContainText('2');
    await expect(page.getByText('Выбрано 2')).toBeVisible();
    // успех
    await page.getByRole('button', { name: 'Поставить статус' }).click();
    await page.getByRole('menuitemradio', { name: 'Бэклог' }).click();
    await expect(page.getByText(/изменено игр 2 из 2/)).toBeVisible();
    expect(mock.mutations.at(-1)).toMatchObject({ method: 'POST', body: { ids: [8, 9], status: 'backlog' } });
    await expect(page.getByText('Выбрано')).toHaveCount(0);
  });

  test('смена фильтров снимает выбор игр (R3)', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/?status=none');
    await page.getByRole('button', { name: 'Выбрать' }).click();
    await page.getByRole('button', { name: 'Выбрать все (2)' }).click();
    await expect(page.getByText('Выбрано 2')).toBeVisible();
    await tab(page, /Бэклог/).click();
    await expect(page.getByText('Выбрано 0')).toBeVisible();
  });

  test('сортировка и вид "список"', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    await page.getByRole('button', { name: 'Список' }).click();
    await expect(page).toHaveURL(/view=list/);
    await expect(coll(page).getByRole('table', { name: 'Игры' })).toBeVisible();
    await coll(page).getByLabel('Сортировка').selectOption('title');
    await expect.poll(() => mock.listCalls.at(-1)?.searchParams.get('sort')).toBe('title');
    await expect(coll(page).locator('.ps-card__title, .ps-row__title').getByText('Bloodborne', { exact: true }).first()).toBeVisible();
  });

  test('диалог игры: role=dialog, aria-modal, заголовок, Esc закрывает и возвращает фокус', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    const trigger = coll(page).getByRole('button', { name: 'Открыть: Stray' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: 'Stray' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toHaveAttribute('aria-modal', 'true');
    await expect(dlg).toBeFocused();
    // Tab не уходит за пределы диалога
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
    }
    await dlg.focus(); // Esc на кнопке статуса: см. BUG-4 ниже
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  // BUG-4: Popover перехватывает Escape (stopPropagation) даже в закрытом состоянии, поэтому при фокусе
  // на кнопке статуса внутри диалога Esc не закрывает диалог.
  test('Esc закрывает диалог, когда фокус на кнопке статуса', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await coll(page).getByRole('button', { name: 'Открыть: Stray' }).click();
    const dlg = page.getByRole('dialog', { name: 'Stray' });
    await dlg.getByRole('button', { name: 'Изменить статус' }).focus();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0, { timeout: 1500 });
  });

  test('меню статуса управляется с клавиатуры', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    const trig = coll(page).getByRole('button', { name: 'Статус: Stray' });
    await trig.focus();
    await page.keyboard.press('Enter');
    await expect(trig).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(trig).toHaveAttribute('aria-expanded', 'false');
    await expect(trig).toBeFocused();
  });

  test('тема: 7 тем переключаются, выбор сохраняется после reload без мигания', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    const attrs: Record<string, string | null> = {
      'Memory Card': 'memory-card', 'Crystal Towers': 'crystal-towers', Wave: 'wave', Tiles: 'tiles', Activity: 'activity', Dark: 'graphite', Night: null,
    };
    for (const [label, attr] of Object.entries(attrs)) {
      await page.getByRole('button', { name: /^Тема:/ }).click();
      await page.getByRole('menuitemradio', { name: label }).click();
      if (attr) await expect(page.locator('html')).toHaveAttribute('data-theme', attr);
      else await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
      await expect(page.getByRole('button', { name: `Тема: ${label}` })).toBeVisible();
    }
    await page.getByRole('button', { name: /^Тема:/ }).click();
    await page.getByRole('menuitemradio', { name: 'Wave' }).click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'wave');
    await expect(page.getByRole('button', { name: 'Тема: Wave' })).toBeVisible();
    // тема переживает переход по разделам
    await page.getByRole('navigation', { name: 'Разделы' }).first().getByRole('link', { name: 'Бэклог' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'wave');
  });

  test('битые значения localStorage темы не ломают страницу', async ({ page, context, baseURL }) => {
    await context.addInitScript(() => localStorage.setItem('ps-theme', '"><script>x'));
    await open(page, context, baseURL!);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });
});

test.describe('коллекция (мобильный 390)', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'mobile', 'мобильный сценарий'); });

  test('каркас: tab bar, нет горизонтального скролла, фильтры в sheet', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    await expect(page.locator('nav.ps-tabbar')).toBeVisible();
    await expect(page.locator('nav.ps-nav')).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: /Фильтры/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Фильтры' });
    await expect(dlg).toBeVisible();
    await dlg.getByLabel('Год завершения').selectOption('2025');
    await dlg.getByRole('button', { name: 'Готово' }).click();
    await expect(dlg).toHaveCount(0);
    await expect.poll(() => mock.listCalls.at(-1)?.searchParams.get('year')).toBe('2025');
    await expect.poll(() => titles(page)).toEqual(['Bloodborne', 'The Witcher 3: Wild Hunt']);
  });

  test('смена статуса через bottom sheet', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    await coll(page).getByRole('button', { name: 'Статус: Stray' }).click();
    const dlg = page.getByRole('dialog', { name: 'Статус' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('menuitemradio', { name: 'Отложено' }).click();
    await expect(dlg).toHaveCount(0);
    expect(mock.mutations.at(-1)).toMatchObject({ body: { status: 'shelved' } });
  });

  test('тема меняется из меню и сохраняется', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await page.getByRole('button', { name: 'Меню', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Tiles' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'tiles');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'tiles');
  });

  test('поиск на мобильном, список без переполнения', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/?view=list');
    await page.getByRole('searchbox', { name: 'Поиск игры' }).fill('ведьмак');
    await expect(coll(page).locator('.ps-row__title', { hasText: 'Ведьмак 3' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
