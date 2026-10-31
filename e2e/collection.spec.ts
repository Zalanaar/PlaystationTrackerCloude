// Приёмка Фазы 3 (обновлено под дизайн A «Полка» + B «Хроника»): коллекция. API эмулируется внутри теста (e2e/collection-mock.ts), БД не нужна.
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed, type Mock } from './collection-mock';
import { signedSession } from './session';

async function open(page: Page, context: import('@playwright/test').BrowserContext, baseURL: string, url = '/', games = seed()): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, games);
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
  await expect(tab(page, /^Все/)).toContainText(/\d/);
  return mock;
}

const coll = (page: Page) => page.locator('section[aria-labelledby="coll-title"]');
const cards = (page: Page) => coll(page).locator('article.ps-card');
const titleSel = '.ps-card__title, .ps-row__title';
const titles = async (page: Page) => (await coll(page).locator(titleSel).allTextContents()).sort();
const tab = (page: Page, name: RegExp) => page.getByRole('group', { name: 'Статус' }).getByRole('button', { name });
/** Раскрывает все свёрнутые годы хроники. */
async function expandAll(page: Page) {
  const closed = coll(page).locator('.ps-year__btn[aria-expanded="false"]');
  while (await closed.count()) await closed.first().click();
}
const card = (page: Page, title: string) => cards(page).filter({ has: page.locator('.ps-card__title', { hasText: new RegExp(`^${title}$`) }) });

test.describe('коллекция (desktop)', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'десктопный сценарий'); });

  test('по умолчанию: Night, строка итогов, лента «Играю», хроника и блоки, счётчики чипов', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    await expect(page.locator('.ps-statline')).toHaveText(/10\s+игр\s*·\s*\d+\s*ч\s*·\s*1\s+платина/);
    await expect(page.getByRole('region', { name: 'Играю' })).toContainText('Horizon Forbidden West');
    await expect(page.getByRole('region', { name: 'Играю' })).toContainText('28 ч 17 м');
    // блоки в порядке: хроника, бэклог, отложено, не разобрано
    await expect(coll(page).locator('h2')).toHaveText([/^Сейчас/, /^2026/, /^2025/, /^2024/, /^Бэклог/, /^Отложено/, /^Не разобрано/]);
    await expect(tab(page, /^Все/)).toContainText('10');
    await expect(tab(page, /Пройдено/)).toContainText('3');
    await expect(tab(page, /Брошено/)).toContainText('2');
    await expect(tab(page, /Не разобрано/)).toContainText('2');
    // старый блок «Продолжить» удалён
    await expect(page.getByText('Продолжить', { exact: true })).toHaveCount(0);
  });

  test('хроника: текущий год раскрыт, прошлые свёрнуты; граница года и месяцы по Москве', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    const y2026 = coll(page).locator('#y2026');
    await expect(y2026.locator('.ps-year__btn')).toHaveAttribute('aria-expanded', 'true');
    await expect(coll(page).locator('#y2025 .ps-year__btn')).toHaveAttribute('aria-expanded', 'false');
    await expect(coll(page).locator('#y2024 .ps-year__btn')).toHaveAttribute('aria-expanded', 'false');
    // Hades: 21:30 UTC 31 декабря = 1 января 2026 по МСК; God of War: февраль 2026
    // Фаза 18: сплошная сетка вместо блоков по месяцам, ориентир по дате: чипы месяцев
    await expect(y2026.locator('h3.ps-month')).toHaveCount(0);
    await expect(y2026.getByRole('navigation', { name: 'Месяцы 2026' }).getByRole('button')).toHaveText([/Фев/, /Янв/]);
    await expect(y2026.locator('.ps-card__title')).toHaveText(['God of War', 'Hades']);
    await expect(y2026.locator('.ps-year__btn')).toContainText('пройдено 1');
    await expect(y2026.locator('.ps-year__btn')).toContainText('брошено 1');
    // плашка даты: только «14 февр.», без года и подписи
    await expect(card(page, 'God of War').locator('.ps-card__date')).toHaveText('14 февр.');
    await expect(coll(page).getByText('Завершено')).toHaveCount(0);
    await coll(page).locator('#y2025 .ps-year__btn').click();
    await expect(coll(page).locator('#y2025 .ps-card__title')).toHaveText(['Bloodborne', 'The Witcher 3: Wild Hunt']);
  });

  test('якоря «Перейти»: год раскрывается, блоки Бэклог и Не разобрано', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    const nav = page.getByRole('navigation', { name: 'Годы и блоки' });
    await expect(nav.getByRole('link')).toHaveText(['2026', '2025', '2024', 'Бэклог', 'Не разобрано']);
    await nav.getByRole('link', { name: '2024' }).click();
    await expect(coll(page).locator('#y2024 .ps-year__btn')).toHaveAttribute('aria-expanded', 'true');
    await expect(coll(page).locator('#y2024 .ps-card__title')).toHaveText(['Ведьмак 3: Дикая Охота']);
  });

  test('превью «Не разобрано» ведёт в Разбор, «Все →» в бэклог', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await expect(coll(page).getByRole('link', { name: 'Разобрать по одной' })).toHaveAttribute('href', '/triage');
    await expect(coll(page).locator('#backlog').getByRole('link', { name: /Все/ })).toHaveAttribute('href', '/backlog');
  });

  test('статус-чипы фильтруют, URL отражает фильтр, "Все" сбрасывает', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    await tab(page, /Пройдено/).click();
    await expect(page).toHaveURL(/status=completed/);
    await expect(tab(page, /Пройдено/)).toHaveAttribute('aria-pressed', 'true');
    await expandAll(page);
    await expect.poll(() => titles(page)).toEqual(['God of War', 'The Witcher 3: Wild Hunt', 'Ведьмак 3: Дикая Охота']);
    await expect.poll(() => mock.listCalls.at(-1)?.searchParams.get('status')).toBe('completed');

    await tab(page, /Не разобрано/).click();
    await expect.poll(() => titles(page)).toEqual(['Gran Turismo 7', 'Tetris Effect']);

    await tab(page, /^Все/).click();
    await expect(page).not.toHaveURL(/status=/);
    await expect(coll(page).locator('#y2026')).toBeVisible();
  });

  test('фильтр по статусу открывается по прямой ссылке и переживает reload', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/?status=backlog&view=list');
    await expect(tab(page, /Бэклог/)).toHaveAttribute('aria-pressed', 'true');
    await expect(coll(page).locator('.ps-row__title', { hasText: 'Stray' })).toBeVisible();
    await page.reload();
    await expect(tab(page, /Бэклог/)).toHaveAttribute('aria-pressed', 'true');
    await expect(coll(page).locator('.ps-row__title', { hasText: 'Stray' })).toBeVisible();
  });

  test('фильтра «Год» нет: параметр year из старой ссылки игнорируется', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, '/?year=2025');
    await expect(page.getByLabel('Год завершения')).toHaveCount(0);
    expect(mock.listCalls.every((u) => !u.searchParams.has('year'))).toBe(true);
  });

  test('хроника грузится одним запросом completed,dropped по completed_at', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    const chron = mock.listCalls.find((u) => u.searchParams.get('status') === 'completed,dropped');
    expect(chron?.searchParams.get('sort')).toBe('completed_at');
    expect(chron?.searchParams.get('limit')).toBe('300');
  });

  test('фильтр без совпадений: пустое состояние со сбросом', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/?status=backlog&q=zzz');
    await expect(page.getByText('Ничего не найдено')).toBeVisible();
    await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
    await expect(page).not.toHaveURL(/q=|status=/);
    await expect(coll(page).locator('#y2026')).toBeVisible();
  });

  test('поиск: debounce, регистр, кириллица, пустой результат, очистка; годы раскрыты', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    const before = mock.listCalls.length;
    const input = page.getByRole('searchbox', { name: 'Поиск игры' });
    await input.pressSequentially('ведьм', { delay: 30 });
    await expect(page).toHaveURL(/q=%D0%B2%D0%B5%D0%B4%D1%8C%D0%BC|q=ведьм/);
    await expect.poll(() => titles(page)).toEqual(['Ведьмак 3: Дикая Охота']);
    // быстрый набор не породил запрос на каждую букву (блоков 5, значит не больше 2 пачек)
    expect(mock.listCalls.length - before).toBeLessThanOrEqual(10);

    await input.fill('WITCHER');
    await expect.poll(() => titles(page)).toEqual(['The Witcher 3: Wild Hunt']);

    await input.fill('zzzz-нет');
    await expect(page.getByText('Ничего не найдено')).toBeVisible();
    await page.getByRole('button', { name: 'Очистить поиск' }).click();
    await expect(coll(page).locator('#y2026')).toBeVisible();
    await expect(input).toBeFocused();
  });

  test('поиск "/" фокусирует поле; поиск + чип комбинируются', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox', { name: 'Поиск игры' })).toBeFocused();
    await page.keyboard.type('witcher');
    await tab(page, /Пройдено/).click();
    await expect.poll(() => titles(page)).toEqual(['The Witcher 3: Wild Hunt']);
  });

  test('гонка фильтров: поздний ответ устаревшего запроса не затирает свежий', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    mock.delayList = (u) => (u.searchParams.get('status') === 'completed' ? 1200 : 0);
    await tab(page, /Пройдено/).click();
    await tab(page, /Бэклог/).click();
    await expect(coll(page).locator(titleSel).getByText('Stray', { exact: true })).toBeVisible();
    await page.waitForTimeout(1600);
    await expect.poll(() => titles(page)).toEqual(['Stray']);
    await expect(tab(page, /Бэклог/)).toHaveAttribute('aria-pressed', 'true');
  });

  test('сбой списка: старые данные остаются, ошибка с повтором', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    mock.listFails = true;
    await tab(page, /Играю/).click();
    await expect(page.getByText('Не удалось обновить список')).toBeVisible();
    mock.listFails = false;
    await page.getByRole('button', { name: 'Повторить' }).first().click();
    await expect(page.getByText('Не удалось обновить список')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Играю' })).toContainText('Horizon Forbidden West');
  });

  test('сортировка не по дате завершения отключает хронику: плоский список «Результаты»', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    await page.getByLabel('Сортировка').selectOption('title');
    await expect(page).toHaveURL(/sort=title/);
    await expect.poll(() => mock.listCalls.at(-1)?.searchParams.get('sort')).toBe('title');
    await expect(page.getByRole('heading', { name: /Результаты/ })).toBeVisible();
    await expect(cards(page)).toHaveCount(10);
    await expect(coll(page).locator('.ps-year__btn')).toHaveCount(0);
    // в плоском списке дата с годом
    await expect(card(page, 'God of War').locator('.ps-card__date')).toHaveText('14 февр. 2026');
  });

  test('«По последней игре»: группы по годам запуска (МСК), часы и число игр, «Не запускались» в конце', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    await page.getByLabel('Сортировка').selectOption('last_played');
    await expect(page).toHaveURL(/sort=last_played/);
    await expect.poll(() => mock.listCalls.at(-1)?.searchParams.get('sort')).toBe('last_played');
    const groups = coll(page).locator('section.ps-chron');
    await expect(groups.locator('.ps-year__y')).toHaveText(['2026', '2025', '2024', 'Не запускались']);
    // Hades: 21:30 UTC 31.12.2025 = 2026 по Москве
    const y2026 = coll(page).locator('#y2026');
    await expect(y2026.locator('.ps-card__title')).toHaveText(['Tetris Effect', 'Horizon Forbidden West', 'Stray', 'Cyberpunk 2077', 'God of War', 'Hades']);
    await expect(y2026.locator('.ps-year__btn')).toContainText('6 игр');
    await expect(y2026.locator('.ps-year__btn')).toContainText('70 ч');
    await expect(coll(page).locator('#y2025 .ps-year__btn')).toContainText('2 игры');
    await expect(coll(page).locator('#y2025 .ps-year__btn')).toContainText('108 ч');
    await expect(coll(page).locator('#y2024 .ps-year__btn')).toContainText('1 игра');
    await expect(coll(page).locator('#never .ps-card__title')).toHaveText(['Gran Turismo 7']);
    // месяцев нет; якоря годов
    await expect(coll(page).locator('.ps-month')).toHaveCount(0);
    const nav = page.getByRole('navigation', { name: 'Годы' });
    await expect(nav.getByRole('link')).toHaveText(['2026', '2025', '2024', 'Не запускались']);
    // свернуть и развернуть год через якорь
    await y2026.locator('.ps-year__btn').click();
    await expect(y2026.locator('.ps-year__btn')).toHaveAttribute('aria-expanded', 'false');
    await expect(y2026.locator('.ps-card')).toHaveCount(0);
    await nav.getByRole('link', { name: '2026' }).click();
    await expect(y2026.locator('.ps-card')).toHaveCount(6);
  });

  test('«По последней игре»: asc переворачивает годы; фильтр статуса и поиск сохраняются', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/?sort=last_played&order=asc');
    await expect(coll(page).locator('section.ps-chron .ps-year__y')).toHaveText(['2024', '2025', '2026', 'Не запускались']);
    await page.goto('/?sort=last_played&status=completed');
    await expect(coll(page).locator('section.ps-chron .ps-year__y')).toHaveText(['2026', '2025', '2024']);
    await expect(coll(page).locator('#y2026 .ps-card__title')).toHaveText(['God of War']);
    await page.goto('/?sort=last_played&q=ведьмак');
    await expect(coll(page).locator('section.ps-chron .ps-year__y')).toHaveText(['2024']);
    await expect(page.getByRole('navigation', { name: 'Годы' })).toHaveCount(0);
  });

  test('BUG-P8-2: смена asc/desc не мигает, группы остаются в прежнем порядке до прихода новой выдачи', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, '/?sort=last_played&view=list');
    const years = coll(page).locator('section.ps-chron .ps-year__y');
    await expect(years).toHaveText(['2026', '2025', '2024', 'Не запускались']);
    mock.delayList = (u) => (u.searchParams.get('order') === 'asc' ? 1200 : 0);
    // в сгруппированном виде кнопки порядка нет: меняем order клиентской навигацией (как это делает setFilters)
    await page.evaluate(() => window.history.pushState(null, '', '/?sort=last_played&view=list&order=asc'));
    await expect.poll(() => mock.listCalls.at(-1)?.searchParams.get('order')).toBe('asc');
    // пока ответ asc в пути, пул и группировка прежние (desc)
    await expect(years).toHaveText(['2026', '2025', '2024', 'Не запускались']);
    await expect(years).toHaveText(['2024', '2025', '2026', 'Не запускались']);
  });

  test('«По последней игре» во всех видах и с «Показать ещё»: заголовок года не дублируется', async ({ page, context, baseURL }) => {
    const extra = Array.from({ length: 60 }, (_, i) => ({
      id: 200 + i, title: `Игра ${i + 1}`, lastPlayedAt: new Date(Date.UTC(2025, 6, 28 - (i % 28), 10, i)).toISOString(), status: 'backlog' as const,
      completedAt: null, droppedAt: null, playSeconds: 3600, playCount: 1, trophies: null,
    }));
    const mock = await open(page, context, baseURL!, '/?sort=last_played', [...seed(), ...extra]);
    // первая страница: 6 игр 2026 + 54 игры 2025
    await expect(cards(page)).toHaveCount(60);
    await expect(coll(page).locator('section.ps-chron .ps-year__y')).toHaveText(['2026', '2025']);
    await coll(page).getByRole('button', { name: /Показать ещё \(10\)/ }).click();
    await expect(cards(page)).toHaveCount(70);
    expect(mock.listCalls.at(-1)?.searchParams.get('offset')).toBe('60');
    await expect(coll(page).locator('section.ps-chron .ps-year__y')).toHaveText(['2026', '2025', '2024', 'Не запускались']);
    await expect(coll(page).locator('#y2025 .ps-card')).toHaveCount(62);
    await expect(coll(page).locator('#y2025 .ps-year__btn')).toContainText('62 игры');
    // Плотно
    await page.getByRole('button', { name: 'Плотно' }).click();
    await expect(coll(page).locator('#y2026 .ps-grid')).toHaveAttribute('data-density', 'dense');
    await expect(coll(page).locator('section.ps-chron .ps-year__y')).toHaveText(['2026', '2025', '2024', 'Не запускались']);
    // Список: таблица в каждой группе, сортировка по заголовку колонки переворачивает годы
    await page.getByRole('button', { name: 'Список' }).click();
    await expect(coll(page).locator('#y2026').getByRole('table', { name: 'Игры' })).toBeVisible();
    await expect(coll(page).locator('#y2026 .ps-row:not(.ps-row--head)')).toHaveCount(6);
    // Смена порядка перезагружает первую страницу (60). Ждём ответ, иначе ловим кадр со старыми 70 играми в новом порядке (флак).
    const ascLoaded = page.waitForResponse((r) => r.url().includes('/api/games?') && new URL(r.url()).searchParams.get('order') === 'asc');
    await coll(page).locator('#y2026').getByRole('button', { name: /Посл\. запуск/ }).click();
    await ascLoaded;
    await expect(page).toHaveURL(/order=asc/);
    // asc, nulls last: 1 игра 2024 + 59 игр 2025; «Не запускались» придут последней страницей
    const rows = coll(page).locator('.ps-row:not(.ps-row--head)');
    await expect(rows).toHaveCount(60);
    await expect(coll(page).locator('section.ps-chron .ps-year__y')).toHaveText(['2024', '2025']);
    await coll(page).getByRole('button', { name: /Показать ещё \(10\)/ }).click();
    await expect(rows).toHaveCount(70);
    await expect(coll(page).locator('section.ps-chron .ps-year__y')).toHaveText(['2024', '2025', '2026', 'Не запускались']);
  });

  test('вид «Плотно»/«Список»: URL, localStorage, восстановление без параметра', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await expect(coll(page).locator('.ps-grid').first()).toHaveAttribute('data-density', 'comfort');
    await page.getByRole('button', { name: 'Плотно' }).click();
    await expect(page).toHaveURL(/view=dense/);
    await expect(coll(page).locator('.ps-grid').first()).toHaveAttribute('data-density', 'dense');
    // 10 колонок на 1280+; названия под обложкой скрыты
    const cols = await coll(page).locator('.ps-grid').first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(10);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Плотно' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Список' }).click();
    await expect(page).toHaveURL(/view=list/);
    await expect(coll(page).getByRole('table', { name: 'Игры' }).first()).toBeVisible();
    // колонки «Платформа» нет
    await expect(coll(page).getByText('Платформа')).toHaveCount(0);
  });

  test('карточка: 6 колонок «Крупно», обложка 3:4, часы одной строкой, фигура статуса и платина', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/?status=completed');
    await expandAll(page);
    const cols = await coll(page).locator('.ps-grid').first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(6);
    const witcher = card(page, 'The Witcher 3: Wild Hunt');
    await expect(witcher.locator('.ps-card__plat')).toBeVisible();
    await expect(witcher.locator('.ps-card__meta')).toHaveText('100 ч');
    const box = await witcher.locator('.ps-card__cover').boundingBox();
    expect(Math.abs(box!.width / box!.height - 0.75)).toBeLessThan(0.02);
    await expect(witcher.getByRole('button', { name: 'Статус: The Witcher 3: Wild Hunt' })).toBeVisible();
    await expect(witcher.locator('.ps-card__glyph')).toHaveAttribute('title', 'Пройдено');
  });

  test('смена статуса: меню на фигуре карточки, счётчики, toast, сохранение после reload', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!);
    await coll(page).getByRole('button', { name: 'Статус: Stray' }).click();
    await page.getByRole('menuitemradio', { name: 'Играю' }).click();
    await expect(page.getByText('Статус изменён: Играю')).toBeVisible();
    expect(mock.mutations.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'playing' } });
    await expect(tab(page, /Играю/)).toContainText('2');
    await expect(tab(page, /Бэклог/)).toContainText('0');
    // игра переехала в ленту «Играю»
    await expect(page.getByRole('region', { name: 'Играю' })).toContainText('Stray');
    await page.reload();
    await expect(tab(page, /Играю/)).toContainText('2');
    await expect(page.getByRole('region', { name: 'Играю' })).toContainText('Stray');
  });

  test('смена статуса на completed: дата = последний запуск, попадает в хронику, плашка «25 окт.»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await coll(page).getByRole('button', { name: 'Статус: Tetris Effect' }).click();
    await page.getByRole('menuitemradio', { name: 'Пройдено' }).click();
    await expect(coll(page).getByRole('navigation', { name: 'Месяцы 2026' }).getByRole('button')).toHaveText([/Окт/, /Фев/, /Янв/]);
    await expect(card(page, 'Tetris Effect').locator('.ps-card__date')).toHaveText('25 окт.');
  });

  test('в отфильтрованном чипе игра исчезает после смены статуса, "Отменить" возвращает', async ({ page, context, baseURL }) => {
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
    await expect(card(page, 'Stray')).toHaveAttribute('data-status', 'backlog');
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
    const mock = await open(page, context, baseURL!);
    await coll(page).locator('#y2025 .ps-year__btn').click();
    await coll(page).getByRole('button', { name: 'Открыть: Bloodborne' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Изменить', exact: true }).click();
    await dlg.getByLabel('Дата завершения').fill('2024-01-15');
    await dlg.getByRole('button', { name: 'Сохранить дату завершения' }).click();
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ method: 'PATCH', body: { droppedAt: '2024-01-15T09:00:00.000Z' } });
    await page.keyboard.press('Escape');
    await expect(coll(page).locator('#y2025 .ps-card__title')).toHaveText(['The Witcher 3: Wild Hunt']);
    await coll(page).locator('#y2024 .ps-year__btn').dispatchEvent('click'); // кнопку может перекрывать toast
    await expect(coll(page).locator('#y2024 .ps-card__title')).toContainText(['Bloodborne']);
  });

  test('"Отменить" не теряет вручную поправленную дату завершения (BUG-3)', async ({ page, context, baseURL }) => {
    const games = seed();
    games[0].completedAt = '2025-04-01T09:00:00.000Z'; // вручную позже last_played_at
    await open(page, context, baseURL!, '/?status=completed', games);
    await expandAll(page);
    await expect(card(page, 'The Witcher 3: Wild Hunt').locator('.ps-card__date')).toHaveText('1 апр.');
    await coll(page).getByRole('button', { name: 'Статус: The Witcher 3: Wild Hunt' }).click();
    await page.getByRole('menuitemradio', { name: 'Бэклог' }).click();
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByText('Статус возвращён')).toBeVisible();
    await expandAll(page);
    await expect(card(page, 'The Witcher 3: Wild Hunt').locator('.ps-card__date')).toHaveText('1 апр.');
  });

  test('массовая смена статуса: выбор, bulk-запрос, сброс режима; сбой откатывает всё', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, '/?status=none');
    await page.getByRole('button', { name: 'Выбрать' }).click();
    await page.getByRole('button', { name: 'Выбрать все (2)' }).click();
    await expect(page.getByText('Выбрано 2')).toBeVisible();
    mock.failNextMutation = 503;
    await page.getByRole('button', { name: 'Поставить статус' }).click();
    await page.getByRole('menuitemradio', { name: 'Бэклог' }).click();
    await expect(page.getByText(/Массовая смена не выполнена, ничего не изменено/)).toBeVisible();
    await expect(tab(page, /Не разобрано/)).toContainText('2');
    await expect(page.getByText('Выбрано 2')).toBeVisible();
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

  test('диалог игры: role=dialog, aria-modal, заголовок, Esc закрывает и возвращает фокус', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    const trigger = coll(page).getByRole('button', { name: 'Открыть: Stray' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: 'Stray' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toHaveAttribute('aria-modal', 'true');
    await expect(dlg).toBeFocused();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
    }
    await dlg.focus();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('Esc закрывает диалог, когда фокус на кнопке статуса (BUG-4)', async ({ page, context, baseURL }) => {
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

  test('тема: семь тем переключаются, выбор сохраняется после reload и переходов', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await page.getByRole('button', { name: /^Тема:/ }).click();
    await expect(page.getByRole('menuitemradio')).toHaveText(['Night', 'Graphite', 'PS1', 'PS2', 'PS3', 'PS4', 'PS5']);
    await page.keyboard.press('Escape');
    const attrs: Record<string, string | null> = { PS1: 'ps1', PS2: 'ps2', PS3: 'ps3', PS4: 'ps4', PS5: 'ps5', Graphite: 'graphite', Night: null };
    for (const [label, attr] of Object.entries(attrs)) {
      await page.getByRole('button', { name: /^Тема:/ }).click();
      await page.getByRole('menuitemradio', { name: label }).click();
      if (attr) await expect(page.locator('html')).toHaveAttribute('data-theme', attr);
      else await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
      await expect(page.getByRole('button', { name: `Тема: ${label}` })).toBeVisible();
    }
    await page.getByRole('button', { name: /^Тема:/ }).click();
    await page.getByRole('menuitemradio', { name: 'Graphite' }).click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'graphite');
    await page.getByRole('navigation', { name: 'Разделы' }).first().getByRole('link', { name: 'Бэклог' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'graphite');
  });

  test('сохранённая activity превращается в PS5 и записывается обратно; PS3 получает data-xmb-month', async ({ page, context, baseURL }) => {
    await context.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('ps-theme', 'activity'); } });
    await open(page, context, baseURL!);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'ps5');
    expect(await page.evaluate(() => localStorage.getItem('ps-theme'))).toBe('ps5');
    expect(await page.evaluate(() => document.cookie)).toContain('ps-theme=ps5');
    await page.getByRole('button', { name: /^Тема:/ }).click();
    await page.getByRole('menuitemradio', { name: 'PS3' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-xmb-month', /^(1|2|3|4|5|6|7|8|9|10|11|12)$/);
  });

  test('сохранённая удалённая тема (wave, tiles...) сбрасывается на Night', async ({ page, context, baseURL }) => {
    await context.addInitScript(() => localStorage.setItem('ps-theme', 'wave'));
    await open(page, context, baseURL!);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    await expect(page.getByRole('button', { name: 'Тема: Night' })).toBeVisible();
  });

  test('битые значения localStorage темы не ломают страницу', async ({ page, context, baseURL }) => {
    await context.addInitScript(() => localStorage.setItem('ps-theme', '"><script>x'));
    await open(page, context, baseURL!);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });

  test('«Разобрать игры» убрано из меню профиля, Разбор открывается вкладкой (Фаза 18)', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await page.getByRole('button', { name: 'Меню профиля' }).click();
    await expect(page.getByRole('menuitem', { name: 'Скрытые игры' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Разобрать игры' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.locator('header nav[aria-label="Разделы"]').getByRole('link', { name: 'Разбор' }).click();
    await expect(page).toHaveURL(/\/triage$/);
  });
});

for (const width of [390, 440]) {
  test.describe(`коллекция (мобильный ${width})`, () => {
    test.use({ viewport: { width, height: 844 } });
    test.beforeEach(({}, info) => { test.skip(info.project.name !== 'mobile', 'мобильный сценарий'); });

    const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    test('каркас: tab bar, нет горизонтального скролла, сортировка в sheet, чипы без подписей', async ({ page, context, baseURL }) => {
      const mock = await open(page, context, baseURL!);
      await expect(page.locator('nav.ps-tabbar')).toBeVisible();
      await expect(page.locator('nav.ps-nav')).toBeHidden();
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);
      // подпись только у «Все» и «Не разобрано»
      await expect(tab(page, /Пройдено/).locator('.ps-filterchip__t')).toBeHidden();
      await expect(tab(page, /Не разобрано/).locator('.ps-filterchip__t')).toBeVisible();
      await page.getByRole('button', { name: /Фильтры/ }).click();
      const dlg = page.getByRole('dialog', { name: 'Фильтры' });
      await expect(dlg).toBeVisible();
      await dlg.getByLabel('Сортировка').selectOption('title');
      await dlg.getByRole('button', { name: 'Готово' }).click();
      await expect(dlg).toHaveCount(0);
      await expect.poll(() => mock.listCalls.at(-1)?.searchParams.get('sort')).toBe('title');
      await expect(cards(page)).toHaveCount(10);
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    });

    test('«По последней игре»: группы по годам без переполнения', async ({ page, context, baseURL }) => {
      await open(page, context, baseURL!, '/?sort=last_played');
      await expect(coll(page).locator('section.ps-chron .ps-year__y')).toHaveText(['2026', '2025', '2024', 'Не запускались']);
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);
      await page.goto('/?sort=last_played&view=list');
      await expect(coll(page).locator('#y2026 .ps-row:not(.ps-row--head)')).toHaveCount(6);
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    });

    test('сетка «Крупно» 2 колонки, «Плотно» 3; хроника без переполнения', async ({ page, context, baseURL }) => {
      await open(page, context, baseURL!);
      const cols = () => coll(page).locator('.ps-grid').first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(await cols()).toBe(2);
      // Фаза 18: сегмент вида на мобильном живёт в sheet «Фильтры»
      await page.getByRole('button', { name: /Фильтры и сортировка/ }).click();
      await page.getByRole('dialog', { name: 'Фильтры' }).getByRole('button', { name: 'Плотно' }).click();
      await page.getByRole('dialog', { name: 'Фильтры' }).getByRole('button', { name: 'Готово' }).click();
      expect(await cols()).toBe(3);
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    });

    test('hero «Играю»: компактные карточки 220px в треке со scroll-snap, без перекрытий', async ({ page, context, baseURL }) => {
      const games = seed();
      games[5].status = 'playing'; games[6].status = 'playing'; // + Stray, Cyberpunk
      await open(page, context, baseURL!, '/', games);
      const items = page.locator('.ps-hero__mini');
      await expect(page.locator('.ps-hero__main')).toBeVisible();
      await expect(items).toHaveCount(2); // первая игра = hero, остальные = компактные
      const boxes = await items.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width }; }));
      for (const b of boxes) expect(Math.round(b.w)).toBe(220);
      for (let i = 1; i < boxes.length; i++) expect(boxes[i].l).toBeGreaterThanOrEqual(boxes[i - 1].r);
      const track = page.locator('.ps-hero__side');
      expect(await track.evaluate((el) => getComputedStyle(el).scrollSnapType)).toContain('x');
      expect(await track.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      // миниатюра и текст не налезают друг на друга
      const first = await page.locator('.ps-hero__mini').first().evaluate((el) => {
        const t = el.querySelector('.ps-hero__thumb')!.getBoundingClientRect();
        const x = el.querySelector('.ps-hero__mtx')!.getBoundingClientRect();
        return { thumbRight: t.right, textLeft: x.left, textRight: x.right, itemRight: el.getBoundingClientRect().right };
      });
      expect(first.textLeft).toBeGreaterThanOrEqual(first.thumbRight);
      expect(first.textRight).toBeLessThanOrEqual(first.itemRight);
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    });

    test('долгий тап по обложке открывает sheet статуса', async ({ page, context, baseURL }) => {
      const mock = await open(page, context, baseURL!);
      const hit = coll(page).getByRole('button', { name: 'Открыть: Stray' });
      await hit.scrollIntoViewIfNeeded();
      const b = (await hit.boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(650);
      await page.mouse.up();
      const dlg = page.getByRole('dialog', { name: 'Статус' });
      await expect(dlg).toBeVisible();
      await dlg.getByRole('menuitemradio', { name: 'Отложено' }).click();
      await expect(dlg).toHaveCount(0);
      expect(mock.mutations.at(-1)).toMatchObject({ body: { status: 'shelved' } });
    });

    test('короткий тап открывает игру', async ({ page, context, baseURL }) => {
      await open(page, context, baseURL!);
      await coll(page).getByRole('button', { name: 'Открыть: Stray' }).tap();
      await expect(page.getByRole('dialog', { name: 'Stray' })).toBeVisible();
    });

    test('тема меняется из меню и сохраняется', async ({ page, context, baseURL }) => {
      await open(page, context, baseURL!);
      await page.getByRole('button', { name: 'Меню', exact: true }).click();
      await expect(page.getByRole('menuitemradio')).toHaveText(['Night', 'Graphite', 'PS1', 'PS2', 'PS3', 'PS4', 'PS5']);
      await page.getByRole('menuitemradio', { name: 'Graphite' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'graphite');
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'graphite');
    });

    test('поиск на мобильном, список без переполнения', async ({ page, context, baseURL }) => {
      await open(page, context, baseURL!, '/?view=list');
      await page.getByRole('searchbox', { name: 'Поиск игры' }).fill('ведьмак');
      await expect(coll(page).locator('.ps-row__title', { hasText: 'Ведьмак 3' })).toBeVisible();
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    });
  });
}
