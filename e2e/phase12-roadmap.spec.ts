// Фаза 12: экран /roadmap. API эмулируется (e2e/roadmap-mock.ts, контракт §17).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { baseState, mockRoadmap, upc, type RmPlanned, type RmState } from './roadmap-mock';
import { signedSession } from './session';

async function open(page: Page, context: BrowserContext, baseURL: string, s: RmState = baseState()): Promise<RmState> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, []);
  await mockRoadmap(page, s);
  await page.goto('/roadmap');
  await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
  return s;
}
const rel = (id: number, title: string, date: string | null, o: Partial<RmPlanned> = {}): RmPlanned => ({
  id, title, releaseDate: date, coverUrl: null, wantAtRelease: false, hoursManual: null, externalSource: null, externalId: null, status: 'planned', ...o,
});
const rowKeys = (page: Page) => page.getByTestId('rm-queue-row').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.rmKey));
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('План: очередь бэклога', () => {
  test('Alt+стрелка меняет порядок, фокус остаётся, PUT уходит одним запросом после паузы', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    await expect(page.getByTestId('rm-queue-row')).toHaveCount(4);
    expect(await rowKeys(page)).toEqual(['g:1', 'g:2', 'g:3', 'g:4']);
    const down = page.getByRole('button', { name: 'Ниже: Хейдес' });
    await down.focus();
    await page.keyboard.press('Alt+ArrowDown');
    expect(await rowKeys(page)).toEqual(['g:2', 'g:1', 'g:3', 'g:4']);
    await expect(page.getByRole('button', { name: 'Ниже: Хейдес' })).toBeFocused();
    await expect(page.getByTestId('rm-live')).toHaveText('Хейдес: позиция 2 из 4');
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect(s.calls.orders).toEqual([[2, 1, 3, 4]]);
    // после пересчёта порядок на экране остаётся серверным
    expect(await rowKeys(page)).toEqual(['g:2', 'g:1', 'g:3', 'g:4']);
  });

  test('кнопки «выше/ниже»: два нажатия подряд = один запрос с последним порядком; крайние кнопки неактивны', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    await expect(page.getByRole('button', { name: 'Выше: Хейдес' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('button', { name: 'Ниже: Игра без часов' })).toHaveAttribute('aria-disabled', 'true');
    // первое нажатие мышью, второе с клавиатуры (фокус остаётся на той же кнопке): иначе строка уходит под липкую шапку
    const up = page.getByRole('button', { name: 'Выше: Год оф Вар' });
    await up.click();
    await up.focus();
    await page.keyboard.press('Enter');
    expect(await rowKeys(page)).toEqual(['g:3', 'g:1', 'g:2', 'g:4']);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect(s.calls.orders).toEqual([[3, 1, 2, 4]]);
  });

  test('Alt+Home / Alt+End переносят в начало и в конец', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    await page.getByRole('button', { name: 'Ниже: Элден Ринг' }).focus();
    await page.keyboard.press('Alt+End');
    expect(await rowKeys(page)).toEqual(['g:1', 'g:3', 'g:4', 'g:2']);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect(s.calls.orders.at(-1)).toEqual([1, 3, 4, 2]);
  });

  test('drag&drop мышью (десктоп)', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'на touch drag отключён: остаются кнопки');
    const s = await open(page, context, baseURL as string);
    const handle = page.locator('[data-rm-key="g:3"] .ps-rm-q__handle');
    await expect(handle).toBeVisible();
    await handle.dragTo(page.locator('[data-rm-key="g:1"]'), { targetPosition: { x: 200, y: 4 } });
    expect(await rowKeys(page)).toEqual(['g:3', 'g:1', 'g:2', 'g:4']);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect(s.calls.orders).toEqual([[3, 1, 2, 4]]);
  });

  test('ручка перетаскивания скрыта на touch', async ({ page, context, baseURL, isMobile }) => {
    test.skip(!isMobile, 'только мобильный проект');
    await open(page, context, baseURL as string);
    await expect(page.locator('[data-rm-key="g:1"] .ps-rm-q__handle')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Ниже: Хейдес' })).toBeVisible();
  });

  test('ошибка сохранения порядка: порядок на экране остаётся, есть «Повторить»', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, baseState({ orderFail: true }));
    await page.getByRole('button', { name: 'Ниже: Хейдес' }).click();
    await expect(page.getByText('Порядок не сохранён')).toBeVisible();
    expect(await rowKeys(page)).toEqual(['g:2', 'g:1', 'g:3', 'g:4']);
    s.orderFail = false;
    await page.getByRole('button', { name: 'Повторить' }).first().click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect(s.calls.orders.at(-1)).toEqual([2, 1, 3, 4]);
  });
});

test.describe('План: релизы', () => {
  test('добавление вручную при недоступном каталоге (503 catalog_unavailable)', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, baseState({ catalog: { status: 503, reason: 'timeout' } }));
    await page.getByRole('button', { name: 'Добавить игру' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Найти в каталоге').fill('Resident');
    await expect(dlg.getByTestId('rm-catalog-fail')).toContainText('Каталог сейчас недоступен. Заполни форму ниже вручную.');
    await dlg.getByLabel('Название').fill('Резидент Ивл Реквием');
    await dlg.getByLabel('Дата релиза').fill('2026-12-05');
    await dlg.getByLabel('Часов на прохождение').fill('14');
    await dlg.getByLabel('Хочу пройти на релизе').check();
    await dlg.getByRole('button', { name: 'Добавить в план' }).click();
    await expect(dlg).toBeHidden();
    expect(s.calls.posts).toEqual([{ title: 'Резидент Ивл Реквием', releaseDate: '2026-12-05', coverUrl: null, wantAtRelease: true, hoursManual: 14 }]);
    const row = page.getByTestId('rm-release');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Резидент Ивл Реквием');
    await expect(row).toContainText('Добавлено вручную');
    await expect(row).toContainText('В плане с даты выхода');
    await expect(page.getByText('Не в плане')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Данные: RAWG (откроется в новой вкладке)' }).first()).toHaveAttribute('href', 'https://rawg.io');
  });

  test('поиск в каталоге: фильтр «Только PlayStation» включён по умолчанию, выбор заполняет форму и уходит с externalId', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, baseState({
      catalog: {
        status: 200,
        candidates: [
          { externalSource: 'rawg', externalId: '11', title: 'Игра ПС', releaseDate: '2027-02-27', coverUrl: 'https://media.rawg.io/a.jpg', platforms: ['PlayStation 5', 'PC'], playstation: true },
          { externalSource: 'rawg', externalId: '12', title: 'Игра ПК', releaseDate: null, coverUrl: null, platforms: ['PC'], playstation: false },
        ],
      },
    }));
    await page.getByRole('button', { name: 'Добавить игру' }).click();
    const dlg = page.getByRole('dialog');
    const chip = dlg.getByRole('button', { name: 'Только PlayStation' });
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await dlg.getByLabel('Найти в каталоге').fill('Игра');
    await expect(dlg.getByRole('button', { name: /Игра ПС/ })).toBeVisible();
    await expect(dlg.getByRole('button', { name: /Игра ПК/ })).toHaveCount(0);
    expect(s.calls.catalogPs.at(-1)).toBe('1');
    await chip.click();
    await expect(dlg.getByRole('button', { name: /Игра ПК/ })).toBeVisible();
    expect(s.calls.catalogPs.at(-1)).toBeNull();
    await expect(dlg.getByRole('button', { name: /Игра ПК/ })).toContainText('Дата не объявлена');
    await dlg.getByRole('button', { name: /Игра ПС/ }).click();
    await expect(dlg.getByLabel('Название')).toHaveValue('Игра ПС');
    await expect(dlg.getByLabel('Дата релиза')).toHaveValue('2027-02-27');
    await expect(dlg.getByText('Из каталога RAWG')).toBeVisible();
    await expect(dlg.getByText('Эта дата вне 2026 года')).toBeVisible();
    await dlg.getByRole('button', { name: 'Добавить в план' }).click();
    await expect(dlg).toBeHidden();
    expect(s.calls.posts[0]).toMatchObject({ title: 'Игра ПС', releaseDate: '2027-02-27', coverUrl: 'https://media.rawg.io/a.jpg', externalSource: 'rawg', externalId: '11', wantAtRelease: false });
  });

  test('конфликт starts_before_year: релиз вышел до начала года, часть в плане, часы сегмента', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, baseState({
      games: [], order: [],
      planned: [
        rel(1, 'Старый релиз', '2025-12-20', { wantAtRelease: true, hoursManual: 30 }),
        rel(2, 'Давний релиз', '2025-11-01', { wantAtRelease: true, hoursManual: 10 }),
      ],
    }));
    const items = page.getByTestId('rm-conflict');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText('релиз вышел до начала года, 1–7 нояб. 2025');
    await expect(items.first()).toContainText('«Давний релиз» вышла 1 нояб. 2025');
    await expect(items.first()).toContainText('Окно целиком в прошлом году');
    await expect(items.nth(1)).toContainText('20–31 дек. 2025');
    await expect(items.nth(1)).toContainText('попадает только часть внутри года');
    // в списке релизов полные часы игры, на таймлайне часы сегмента (21 день года из 21: 30 ч; проверяем что строка не помечена ошибкой)
    await expect(page.getByTestId('rm-release').first().getByLabel('Часов на прохождение')).toHaveValue('10');
  });

  test('каталог не настроен и лимит: понятные сообщения, форма не блокируется', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, baseState({ catalog: { status: 503, reason: 'no_key' } }));
    await page.getByRole('button', { name: 'Добавить игру' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Найти в каталоге').fill('Игра');
    await expect(dlg.getByText('Поиск по каталогу не настроен. Заполни форму вручную.')).toBeVisible();
    s.catalog = { status: 503, reason: 'rate_limited' };
    await dlg.getByLabel('Найти в каталоге').fill('Игра два');
    await expect(dlg.getByText('Лимит запросов к каталогу исчерпан. Попробуй позже или заполни форму вручную.')).toBeVisible();
    await dlg.getByLabel('Название').fill('Ручная');
    await expect(dlg.getByRole('button', { name: 'Добавить в план' })).toBeEnabled();
  });

  test('валидация: галка без даты и пустое название', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await page.getByRole('button', { name: 'Добавить игру' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByRole('button', { name: 'Добавить в план' })).toBeDisabled();
    await expect(dlg.getByLabel('Хочу пройти на релизе')).toBeDisabled();
    await dlg.getByLabel('Название').fill('Игра');
    await dlg.getByLabel('Обложка').fill('http://example.com/a.jpg');
    await dlg.getByLabel('Часов на прохождение').fill('0');
    await dlg.getByRole('button', { name: 'Добавить в план' }).click();
    await expect(dlg.getByText('Ссылка должна начинаться с https://')).toBeVisible();
    await expect(dlg.getByText('Введи число от 0,5 до 999')).toBeVisible();
    await expect(dlg).toBeVisible();
  });

  test('правка часов, галка «на релизе», удаление и отмена удаления', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, baseState({ planned: [rel(7, 'Будущая игра', '2026-12-10', { hoursManual: 20 })] }));
    const row = page.getByTestId('rm-release');
    await expect(row).toContainText('Идёт в очереди после бэклога');
    await expect(row).not.toContainText('Не в плане');
    await row.getByLabel('Хочу пройти на релизе').check();
    await expect(row).toContainText('В плане с даты выхода');
    expect(s.calls.patches).toEqual([{ id: 7, body: { wantAtRelease: true } }]);
    const hours = row.getByLabel('Часов на прохождение');
    await hours.fill('25,5');
    await hours.blur();
    await expect.poll(() => s.calls.patches.at(-1)).toEqual({ id: 7, body: { hoursManual: 25.5 } });
    await row.getByRole('button', { name: 'Удалить: Будущая игра' }).click();
    await row.getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(row).toHaveCount(0);
    expect(s.calls.deletes).toEqual([7]);
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByTestId('rm-release')).toHaveCount(1);
    expect(s.calls.posts[0]).toMatchObject({ title: 'Будущая игра', releaseDate: '2026-12-10', wantAtRelease: true, hoursManual: 25.5 });
  });

  test('ошибка загрузки релизов не роняет остальные блоки', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, baseState({ plannedFail: 503 }));
    await expect(page.getByText('Не удалось загрузить релизы')).toBeVisible();
    await expect(page.getByTestId('rm-queue-row')).toHaveCount(4);
    await expect(page.getByRole('heading', { name: 'Настройки плана' })).toBeVisible();
  });
});

test.describe('План: состояния', () => {
  test('первый запуск: приветствие и «Составить план»', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, baseState({ configured: false, hoursPerWeek: null }));
    await expect(page.getByRole('heading', { name: 'План на год' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Таймлайн 2026' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Составить план' }).click();
    await expect(page.getByRole('heading', { name: 'Настройки плана' })).toBeVisible();
    expect(s.calls.settings).toEqual([{ year: 2026, hoursPerWeek: 10 }]);
    await expect(page.getByText('План составлен')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Таймлайн 2026' })).toBeVisible();
  });

  test('пустые состояния: нет игр и релизов', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, baseState({ games: [], order: [] }));
    await expect(page.getByRole('heading', { name: 'На таймлайне пока пусто' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'В бэклоге нет игр' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Релизов пока нет' })).toBeVisible();
    await expect(page.getByText('Пока нечего сравнивать: в плане нет игр')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Данные: RAWG (откроется в новой вкладке)' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'К коллекции' })).toHaveAttribute('href', '/');
  });

  test('ошибка GET /api/roadmap: сообщение вместо падения, шапка работает', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, baseState({ roadmapFail: 503 }));
    await expect(page.getByRole('heading', { name: 'Что-то пошло не так' })).toBeVisible();
    await expect(page.getByText('Не удалось загрузить план. Попробуй обновить страницу.')).toBeVisible();
    s.roadmapFail = null;
    await page.getByRole('button', { name: 'Обновить' }).click();
    await expect(page.getByTestId('rm-queue-row')).toHaveCount(4);
  });

  test('конфликт виден текстом (причина из API), без тихого сдвига', async ({ page, context, baseURL, isMobile }) => {
    await open(page, context, baseURL as string, baseState({
      games: [], order: [],
      planned: [
        rel(1, 'Релиз Альфа', '2026-11-02', { wantAtRelease: true, hoursManual: 40 }),
        rel(2, 'Релиз Бета', '2026-11-10', { wantAtRelease: true, hoursManual: 20 }),
      ],
    }));
    const item = page.getByTestId('rm-conflict');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('Конфликт 1: пересечение релизов, 10–29 нояб.');
    await expect(item).toContainText('«Релиз Альфа»');
    await expect(item).toContainText('«Релиз Бета»');
    await expect(item).toContainText('Сдвинь дату, увеличь часы в неделю или сними галку «Хочу пройти на релизе»');
    await expect(page.getByRole('link', { name: 'Конфликтов: 1' })).toBeVisible();
    if (!isMobile) await expect(page.locator('.ps-rm-g__clabel')).toContainText('Конфликт 1 · 10–29 нояб.');
    else await expect(page.getByTestId('rm-month').filter({ hasText: 'Ноябрь' })).toContainText('Конфликт 1');
  });

  test('«Не успеваю» и «Нужны часы»: без кнопки «Применить N ч в неделю»', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, baseState({
      games: [
        { id: 1, title: 'Хейдес', hours: 22 },
        { id: 2, title: 'Бесконечная игра', hours: 600 },
        { id: 4, title: 'Игра без часов', hours: null },
      ],
      order: [1, 2, 4],
    }));
    const over = page.locator('#rm-over');
    await expect(over).toContainText('Не успеваю');
    await expect(over).toContainText('Бесконечная игра');
    await expect(over).toContainText('Недели до конца года заняты');
    await expect(over).toContainText('не хватает');
    await expect(page.getByRole('button', { name: /Применить \d/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Не успеваю: 1/ })).toBeVisible();
    // «Нужны часы»: ярлык в очереди ведёт к полю, сохранение через PATCH длительности
    await page.locator('[data-rm-key="g:4"]').getByRole('button', { name: 'Нужны часы' }).click();
    const need = page.getByTestId('rm-need-row');
    await expect(need.getByLabel('Часов на прохождение: Игра без часов')).toBeFocused();
    await need.getByLabel('Часов на прохождение: Игра без часов').fill('12');
    await need.getByRole('button', { name: 'Сохранить' }).click();
    await expect(need).toHaveCount(0);
    expect(s.calls.durations).toEqual([{ id: 4, hours: 12 }]);
    await expect(page.locator('[data-rm-key="g:4"]')).toContainText('12 ч');
  });
});

test.describe('План: настройки и прогресс', () => {
  test('смена часов в неделю: PUT настроек, затем повторный GET плана', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    await expect(page.getByText('Отстаю на 19 ч')).toBeVisible();
    await expect(page.getByText('Допуск «по плану»: 2 ч')).toBeVisible();
    const before = s.calls.roadmap;
    const apply = page.getByRole('button', { name: 'Применить' });
    await expect(apply).toBeDisabled();
    await page.getByLabel('Часов в неделю').fill('15');
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(page.getByText('План пересчитан')).toBeVisible();
    expect(s.calls.settings).toEqual([{ year: 2026, hoursPerWeek: 15 }]);
    expect(s.calls.roadmap).toBeGreaterThan(before);
  });

  test('невалидные часы: ошибка у поля, кнопка выключена', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await page.getByLabel('Часов в неделю').fill('0');
    await expect(page.getByText('Введи число от 0,5 до 100')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Применить' })).toBeDisabled();
  });
});

test.describe('План: вёрстка', () => {
  test('вкладка «План» в навигации активна', async ({ page, context, baseURL, isMobile }) => {
    await open(page, context, baseURL as string);
    const nav = isMobile ? page.locator('nav.ps-tabbar') : page.locator('header nav.ps-nav');
    await expect(nav.getByRole('link')).toHaveCount(4); // Фаза 18: 4 вкладки, «План» в подвкладках группы «Бэклог»
    await expect(nav.getByRole('link', { name: 'Бэклог' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation', { name: 'Раздел бэклога' }).getByRole('link', { name: 'План' })).toHaveAttribute('aria-current', 'page');
  });

  for (const width of [360, 320]) {
    test(`${width} px: нет горизонтального скролла страницы, подписи tab bar целы`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page, context, baseURL as string, baseState({
        planned: [
          rel(1, 'Релиз Альфа с очень длинным названием для проверки переноса строки', '2026-11-02', { wantAtRelease: true, hoursManual: 40 }),
          rel(2, 'Релиз Бета', '2026-11-10', { wantAtRelease: true, hoursManual: 20 }),
        ],
      }));
      await expect(page.getByTestId('rm-queue-row').first()).toBeVisible();
      expect(await noHScroll(page)).toBe(true);
      const labels = await page.locator('nav.ps-tabbar .ps-tab > span:last-child').evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== 'none').map((e) => ({ t: e.textContent, ok: e.scrollWidth <= e.clientWidth + 1 })));
      expect(labels.map((l) => l.t)).toEqual(['Коллекция', 'Бэклог', 'Статистика', 'Разбор']);
      expect(labels.every((l) => l.ok)).toBe(true);
      await page.getByRole('button', { name: 'Добавить игру' }).click();
      expect(await noHScroll(page)).toBe(true);
    });
  }

  test('768 px: страница без горизонтального скролла (Gantt скроллится внутри панели)', async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await open(page, context, baseURL as string);
    await expect(page.getByTestId('rm-bar').first()).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
  });

  test('десктоп: полоса таймлайна ведёт к строке игры', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'Gantt только на десктопе');
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, context, baseURL as string);
    const bar = page.locator('.ps-rm-bar[data-key="g:2"]');
    await expect(bar).toHaveAttribute('aria-label', /Элден Ринг: очередь, с .* по .*, позиция 2/);
    await bar.click();
    await expect(page.locator('[data-rm-zone="queue"][data-rm-key="g:2"]')).toBeFocused();
  });
});

test.describe('План: убрать из плана и «Не распределено»', () => {
  test('«Не успеваю» нет в очереди, а PUT порядка получает полный список со скрытой игрой', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, baseState({
      games: [{ id: 1, title: 'Хейдес', hours: 22 }, { id: 2, title: 'Бесконечная игра', hours: 600 }, { id: 3, title: 'Год оф Вар', hours: 30 }],
      order: [1, 2, 3],
    }));
    await expect(page.getByTestId('rm-queue-row')).toHaveCount(2);
    expect(await rowKeys(page)).toEqual(['g:1', 'g:3']);
    await expect(page.locator('[data-rm-zone="queue"][data-rm-key="g:2"]')).toHaveCount(0);
    await expect(page.locator('#rm-over')).toContainText('Бесконечная игра');
    await page.getByRole('button', { name: 'Ниже: Хейдес' }).click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    // скрытая g:2 сохраняет своё место (середина), видимые меняются местами
    expect(s.calls.orders).toEqual([[3, 2, 1]]);
  });

  test('бэклог: убрать из плана -> «Не распределено» -> вернуть (в конец очереди)', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, baseState({ order: [1, 2, 3, 4] }));
    await page.getByRole('button', { name: 'Ещё: Хейдес' }).click();
    await page.getByRole('menuitem', { name: 'Убрать из плана' }).click();
    await expect(page.getByText('Убрано из плана')).toBeVisible();
    expect(s.calls.exclusions).toEqual([{ method: 'POST', gameId: 1 }]);
    expect(await rowKeys(page)).toEqual(['g:2', 'g:3', 'g:4']);
    const un = page.getByTestId('rm-unallocated');
    await expect(un).toHaveCount(1);
    await expect(un).toContainText('Хейдес');
    await un.getByRole('button', { name: 'Вернуть в план' }).click();
    await expect(page.getByTestId('rm-unallocated')).toHaveCount(0);
    expect(s.calls.exclusions.at(-1)).toEqual({ method: 'DELETE', gameId: 1 });
    expect(await rowKeys(page)).toEqual(['g:2', 'g:3', 'g:1', 'g:4']); // игра без часов (нет дат) остаётся в конце
  });

  test('тост «Отменить» возвращает убранную игру', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    await page.getByRole('button', { name: 'Убрать из плана: Игра без часов' }).click();
    await expect(page.getByTestId('rm-need-row')).toHaveCount(0);
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByTestId('rm-need-row')).toHaveCount(1);
    expect(s.calls.exclusions).toEqual([{ method: 'POST', gameId: 4 }, { method: 'DELETE', gameId: 4 }]);
  });

  test('релиз: убрать из плана, вернуть и удалить совсем с подтверждением', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, baseState({ planned: [rel(7, 'Будущая игра', '2026-12-10', { hoursManual: 20, wantAtRelease: true })] }));
    await page.getByRole('button', { name: 'Убрать из плана: Будущая игра' }).click();
    expect(s.calls.patches.at(-1)).toEqual({ id: 7, body: { status: 'unallocated' } });
    await expect(page.getByTestId('rm-release')).toHaveCount(0);
    const un = page.getByTestId('rm-unallocated');
    await expect(un).toContainText('Будущая игра');
    await un.getByRole('button', { name: 'Вернуть в план' }).click();
    expect(s.calls.patches.at(-1)).toEqual({ id: 7, body: { status: 'planned' } });
    await expect(page.getByTestId('rm-release')).toHaveCount(1);
    await page.getByRole('button', { name: 'Убрать из плана: Будущая игра' }).click();
    await page.getByTestId('rm-unallocated').getByRole('button', { name: 'Удалить совсем' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(page.getByTestId('rm-unallocated')).toHaveCount(0);
    expect(s.calls.deletes).toEqual([7]);
  });
});

test.describe('План: предстоящие релизы', () => {
  const cands = () => ({
    pages: [[upc(1), upc(2), upc(3)], [upc(4)]],
    fail: null,
  });
  test('список сразу: добавление без перезагрузки, «В плане», «Не распределено», «Показать ещё»', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, baseState({
      upcoming: cands(),
      planned: [
        rel(5, 'Новинка 2', '2026-12-12', { externalSource: 'rawg', externalId: '2' }),
        { ...rel(6, 'Новинка 3', '2026-12-13', { externalSource: 'rawg', externalId: '3' }), status: 'cancelled' },
      ],
    }));
    const rows = page.getByTestId('rm-upcoming-row');
    await expect(rows).toHaveCount(3);
    expect(s.calls.upcoming).toEqual([1]);
    await expect(rows.nth(1)).toContainText('В плане');
    await expect(rows.nth(1).getByRole('button')).toHaveCount(0);
    await expect(rows.nth(2)).toContainText('Не распределено');
    await expect(rows.nth(0)).toContainText('PS5');
    await expect(page.getByRole('link', { name: 'Данные: RAWG (откроется в новой вкладке)' }).first()).toBeVisible();
    // «В план»: wantAtRelease по умолчанию, часы потом вручную
    await rows.nth(0).getByRole('button', { name: 'В план: Новинка 1' }).click();
    await expect(rows.nth(0)).toContainText('В плане');
    expect(s.calls.posts).toEqual([{ title: 'Новинка 1', releaseDate: '2026-12-11', coverUrl: null, wantAtRelease: true, hoursManual: null, externalSource: 'rawg', externalId: '1' }]);
    await expect(rows).toHaveCount(3);
    expect(s.calls.upcoming).toEqual([1]);
    await expect(page.getByTestId('rm-release').filter({ hasText: 'Новинка 1' })).toHaveCount(1);
    await expect(page.getByTestId('rm-need-row').filter({ hasText: 'Новинка 1' })).toHaveCount(1);
    // вернуть из «Не распределено»
    await rows.nth(2).getByRole('button', { name: 'Вернуть в план' }).click();
    expect(s.calls.patches.at(-1)).toEqual({ id: 6, body: { status: 'planned' } });
    await expect(rows.nth(2)).toContainText('В плане');
    // следующая страница
    await page.getByRole('button', { name: 'Показать ещё' }).click();
    await expect(rows).toHaveCount(4);
    expect(s.calls.upcoming).toEqual([1, 2]);
    await expect(page.getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);
  });

  test('ошибка каталога 503: понятное сообщение, страница и ручной ввод работают, повтор', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, baseState({ upcoming: { pages: [[upc(1)]], fail: { status: 503, reason: 'timeout' } } }));
    await expect(page.getByTestId('rm-upcoming-fail')).toContainText('Каталог сейчас недоступен. Найди игру по названию или добавь вручную.');
    await expect(page.getByTestId('rm-queue-row')).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Добавить игру' })).toBeVisible();
    s.upcoming.fail = null;
    await page.getByTestId('rm-upcoming-fail').getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByTestId('rm-upcoming-row')).toHaveCount(1);
  });
});

test.describe('План: игры-сервисы', () => {
  test('таблица со справкой, без добавления в план; пустая скрыта', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, baseState({
      serviceGames: [{ gameId: 7, title: 'Фортнайт', coverUrl: null, playedHours: 312.4 }, { gameId: 8, title: 'Дестини', coverUrl: null, playedHours: 80 }],
    }));
    const t = page.getByTestId('rm-services');
    await expect(t.locator('tbody tr')).toHaveCount(2);
    await expect(t).toContainText('Фортнайт');
    await expect(t).toContainText('312 ч');
    await expect(page.getByRole('heading', { name: /Игры-сервисы: в план не берём/ })).toBeVisible();
    await expect(page.locator('#rm-services').getByRole('button')).toHaveCount(0);
  });
  test('нет сервисов: блока нет', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await expect(page.getByTestId('rm-services')).toHaveCount(0);
  });
});

test.describe('План: единое расписание в очереди', () => {
  const dawn = () => rel(20, 'Анти Дон 2', '2026-01-28', { wantAtRelease: true, hoursManual: 14, externalSource: 'rawg', externalId: '20' });

  test('релиз с галкой стоит в очереди по дате, с бейджем «Релиз», без ручки и кнопок, номера только у бэклога', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, baseState({ planned: [dawn()] }));
    await expect(page.getByTestId('rm-queue-row')).toHaveCount(5);
    expect(await rowKeys(page)).toEqual(['g:1', 'g:2', 'p:20', 'g:3', 'g:4']);
    const row = page.locator('[data-rm-zone="queue"][data-rm-key="p:20"]');
    await expect(row).toContainText('Релиз');
    await expect(row).toContainText('выходит 28 янв.');
    await expect(row).toContainText('ручн.');
    await expect(row.getByRole('button', { name: /Выше|Ниже/ })).toHaveCount(0);
    await expect(row.locator('.ps-rm-q__handle')).toHaveText('');
    await expect(row.locator('[data-act="menu"]')).toBeVisible();
    // номера бэклога идут подряд без учёта релиза
    const nums = await page.locator('[data-rm-key] .ps-rm-q__n[aria-label^="Позиция"]').evaluateAll((els) => els.map((e) => e.textContent));
    expect(nums).toEqual(['1', '2', '3', '4']);
    await expect(page.getByText('релизы с галкой стоят по дате выхода и двигаться не могут')).toBeVisible();
  });

  test('перестановка бэклога через релизную строку: PUT только с g:* и полным порядком', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, baseState({ planned: [dawn()] }));
    await page.getByRole('button', { name: 'Ниже: Хейдес' }).click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect(s.calls.orders).toEqual([[2, 1, 3, 4]]);
    // после пересчёта расписание по датам: релиз 28 янв. теперь стоит между играми
    await expect.poll(() => rowKeys(page)).toEqual(['g:2', 'p:20', 'g:1', 'g:3', 'g:4']);
  });

  test('«В план» из предстоящих без часов: строка сразу в очереди по дате с «Нужны часы», после ввода часов получает период', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, baseState({ upcoming: { pages: [[upc(20, { title: 'Анти Дон 2', releaseDate: '2026-01-28' })]], fail: null } }));
    const before = s.calls.roadmap;
    await page.getByRole('button', { name: 'В план: Анти Дон 2' }).click();
    await expect(page.getByTestId('rm-upcoming-row')).toContainText('В плане');
    await expect.poll(() => s.calls.roadmap).toBeGreaterThan(before);
    const id = s.planned[0].id;
    const row = page.locator(`[data-rm-zone="queue"][data-rm-key="p:${id}"]`);
    // без часов: по дате выхода 28 янв. (после Элден Ринга с 17 янв., до Года оф Вар), без периода
    await expect(row).toBeVisible();
    await expect(row).toContainText('Релиз');
    await expect(row).toContainText('Нужны часы');
    await expect(row).toContainText('выходит 28 янв.');
    await expect(row.getByRole('button', { name: /Выше|Ниже/ })).toHaveCount(0);
    expect(await rowKeys(page)).toEqual(['g:1', 'g:2', `p:${id}`, 'g:3', 'g:4']);
    await expect(page.getByTestId('rm-need-row').filter({ hasText: 'Анти Дон 2' })).toHaveCount(1);
    // «Указать часы» ведёт к полю в карточке релиза
    await row.getByRole('button', { name: 'Указать часы' }).click();
    const field = page.getByTestId('rm-release').getByLabel('Часов на прохождение');
    await expect(field).toBeFocused();
    await field.fill('14');
    await field.blur();
    await expect(row).not.toContainText('Нужны часы');
    await expect(row).toContainText('28 янв.');
    await expect(row).toContainText('ручн.');
    expect(await rowKeys(page)).toEqual(['g:1', 'g:2', `p:${id}`, 'g:3', 'g:4']);
  });

  test('меню релизной строки: «Убрать из плана»', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, baseState({ planned: [dawn()] }));
    await page.getByRole('button', { name: 'Ещё: Анти Дон 2' }).click();
    await page.getByRole('menuitem', { name: 'Убрать из плана' }).click();
    expect(s.calls.patches.at(-1)).toEqual({ id: 20, body: { status: 'unallocated' } });
    await expect(page.locator('[data-rm-zone="queue"][data-rm-key="p:20"]')).toHaveCount(0);
  });

  test('drag&drop бэклога через релизную строку (десктоп)', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'на touch drag отключён');
    const s = await open(page, context, baseURL as string, baseState({ planned: [dawn()] }));
    await page.locator('[data-rm-key="g:3"] .ps-rm-q__handle').dragTo(page.locator('[data-rm-key="g:1"]'), { targetPosition: { x: 200, y: 4 } });
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect(s.calls.orders).toEqual([[3, 1, 2, 4]]);
  });
});
