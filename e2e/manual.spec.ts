// Фаза 43: Бэклог, игры «не куплено». Поиск RAWG, пометка, «Купил» с «Отменить», «Убрать», «Это та игра?». API эмулируется.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G, type Mock } from './collection-mock';
import { cand, mgame, mockManual, type ManualMock, type MMatch } from './manual-mock';
import { isMobile } from './backlog-ui';
import { signedSession } from './session';
import { addBtn } from './header-actions';

const bl = (id: number, title: string, o: Partial<G> = {}): G => ({
  id, title, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null, ...o,
});
const games = (): G[] => [bl(1, 'Альфа Экшен'), bl(2, 'Браво Гонки'), bl(3, 'Играю Сейчас', { status: 'playing' })];
const tourStub = JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } });

async function open(
  page: Page, context: BrowserContext, baseURL: string, o: Partial<ManualMock> = {}, url = '/backlog', inbox: Record<string, unknown> | null = null,
): Promise<{ mock: Mock; manual: ManualMock }> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: tourStub }));
  await page.addInitScript(() => localStorage.setItem('ps-wn-seen:1', '14'));
  const mock = await mockApi(page, games());
  mock.inbox = inbox;
  const manual = await mockManual(page, o);
  await page.goto(url);
  if (url.startsWith('/backlog')) {
    await page.getByRole('heading', { name: 'Бэклог', level: 1 }).waitFor();
    await page.locator('.ps-card:not(.ps-card--sk), .ps-blrow, .ps-empty').first().waitFor();
  } else {
    await page.locator('.ps-card').first().waitFor();
  }
  return { mock, manual };
}
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const hades = () => cand('3328', 'Hades II', { releaseDate: '2026-12-05' });
const row = (page: Page, title: string) => page.locator('[data-manual]').filter({ hasText: title });

/** Выбрать игру в строке результата и отправить корзину (по умолчанию «Не купил»). */
async function addFirst(page: Page, n = 0) {
  await page.getByTestId('add-row').nth(n).getByTestId('add-pick').click();
  await page.getByTestId('add-cart-submit').click();
}

async function search(page: Page, q: string) {
  await page.getByTestId('add-input').fill(q);
  await page.getByTestId('add-submit').click();
}

test.describe('Поиск и добавление', () => {
  test('поиск уходит только по Enter/«Найти», не на символ; добавление, пометка, итоговый тост', async ({ page, context, baseURL }) => {
    const { manual } = await open(page, context, baseURL!, { candidates: [hades(), cand('77', 'Hades Remix', { releaseDate: null, platforms: ['PlayStation 4'] })] });
    const add = addBtn(page);
    await expect(add).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(add).toHaveAttribute('aria-label', 'Добавить из магазина PS');
    await add.click();
    const sheet = page.getByRole('dialog', { name: 'Добавить из магазина PS' });
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('add-input')).toBeFocused();
    await expect(page.getByTestId('add-empty')).toContainText('Найди игру из магазина PS');
    await expect(sheet).toContainText('Данные об играх');
    await expect(sheet.getByRole('link', { name: /RAWG/ })).toHaveAttribute('rel', 'noopener noreferrer');
    // < 2 символов: кнопка выключена
    await page.getByTestId('add-input').fill('h');
    await expect(page.getByTestId('add-submit')).toBeDisabled();
    await page.getByTestId('add-input').pressSequentially('ades', { delay: 20 });
    await page.waitForTimeout(300);
    expect(manual.searchCalls).toEqual([]);
    await page.getByTestId('add-input').press('Enter');
    await expect(page.getByTestId('add-row')).toHaveCount(2);
    expect(manual.searchCalls).toEqual(['hades']);
    const first = page.getByTestId('add-row').first();
    await expect(first).toContainText('Hades II');
    await expect(first).toContainText('Релиз 5 дек. 2026');
    await expect(first).toContainText('PS5 · PS4');
    await expect(page.getByTestId('add-row').nth(1)).toContainText('Дата не объявлена');
    await expect(first.getByTestId('add-buy-no')).toHaveAttribute('aria-checked', 'true');
    await addFirst(page);
    await expect(first.getByTestId('add-row-done')).toHaveText('Добавлено · Не куплено');
    await expect(page.getByTestId('add-input')).toBeFocused();
    expect(manual.batchBodies[0]).toEqual([{ externalSource: 'rawg', externalId: '3328', title: 'Hades II', coverUrl: null, releaseDate: '2026-12-05', notPurchased: true }]);
    // повторное добавление невозможно: кнопки выбора нет, строка осталась
    await expect(first.getByTestId('add-pick')).toHaveCount(0);
    await page.getByTestId('add-close').click();
    await expect(sheet).toHaveCount(0);
    await expect(add).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Добавлено в бэклог: «Hades II»' })).toBeVisible();
    const r = row(page, 'Hades II');
    await expect(r).toHaveCount(1);
    await expect(r.getByTestId('not-purchased')).toHaveText('Не куплено');
    await expect(r).not.toContainText(/Играть/);
    await expect(r.getByRole('button', { name: 'Купил: Hades II' })).toBeVisible();
    // окна игры нет: клик по записи ничего не открывает
    await r.locator('.ps-card__cover, .ps-blrow__text').first().click({ force: true });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('«Уже в бэклоге» приходит от сервера и не даёт добавить повторно', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { candidates: [cand('3328', 'Hades II', { inBacklog: true })] });
    await addBtn(page).click();
    await search(page, 'hades');
    const done = page.getByTestId('add-row-done');
    await expect(done).toHaveText('Уже в бэклоге');
    await expect(page.getByTestId('add-pick')).toHaveCount(0);
  });

  test('дубль: блок решения в корзине, «Всё равно добавить» шлёт confirmDuplicate, строка «Нужно решение»', async ({ page, context, baseURL }) => {
    const { manual } = await open(page, context, baseURL!, { candidates: [hades()], batchDup: ['3328'] });
    await addBtn(page).click();
    await search(page, 'hades');
    await addFirst(page);
    const warn = page.getByTestId('add-warn');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText('Такая игра уже есть');
    await expect(warn).toContainText('В твоей библиотеке PSN: «Hades II (PSN)»');
    await expect(page.getByTestId('add-row-need')).toHaveText('Нужно решение');
    await expect(page.getByTestId('add-cart-submit')).toBeDisabled();
    expect(manual.items).toHaveLength(0);
    // закрытие с непустой корзиной спрашивает подтверждение, Esc = «Вернуться»
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('add-close-confirm')).toBeVisible();
    await expect(page.getByTestId('add-close-back')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('add-close-confirm')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Добавить из магазина PS' })).toBeVisible();
    await page.getByTestId('add-warn-confirm').click();
    await expect(page.getByTestId('add-row-done')).toHaveText('Добавлено · Не куплено');
    expect(manual.batchBodies.at(-1)).toEqual([expect.objectContaining({ externalId: '3328', confirmDuplicate: true })]);
    expect(manual.items).toHaveLength(1);
  });

  test('ошибка добавления: лимит записей у элемента и сбой всего запроса с повтором', async ({ page, context, baseURL }) => {
    const { manual } = await open(page, context, baseURL!, {
      candidates: [hades()], batchFail: { '3328': 'manual_limit' }, batchReplies: [{ status: 500, error: { code: 'internal', message: 'x' } }],
    });
    await addBtn(page).click();
    await search(page, 'hades');
    await page.getByTestId('add-pick').click();
    // сбой запроса целиком: корзина цела, «Повторить 1», повтор безопасен
    await page.getByTestId('add-cart-submit').click();
    await expect(page.getByTestId('add-cart-banner')).toContainText('Не удалось добавить. Повтори.');
    await expect(page.getByTestId('add-cart-submit')).toHaveText('Повторить 1');
    await page.getByTestId('add-cart-submit').click();
    await expect(page.getByRole('alert').filter({ hasText: 'уже 200 игр' })).toBeVisible();
    await expect(page.getByTestId('add-cart-banner')).toContainText('Добавлено 0 из 1. Остальные: исправь или убери.');
    expect(manual.items).toHaveLength(0);
    delete manual.batchFail['3328'];
    await page.getByTestId('add-cart-submit').click();
    await expect(page.getByTestId('add-row-done')).toHaveText('Добавлено · Не куплено');
    expect(manual.items).toHaveLength(1);
  });

  test('состояния панели: нет результатов, лимит с датой, каталог недоступен, ошибка и повтор, офлайн', async ({ page, context, baseURL }) => {
    const { manual } = await open(page, context, baseURL!, { candidates: [hades()] });
    await addBtn(page).click();
    await search(page, 'zzzz');
    await expect(page.getByTestId('add-noresults')).toContainText('По запросу «zzzz» нет игр для PS5 и PS4');
    await page.getByRole('button', { name: 'Очистить поиск' }).click();
    await expect(page.getByTestId('add-empty')).toBeVisible();
    await expect(page.getByTestId('add-input')).toBeFocused();

    // ошибка поиска и повтор
    manual.searchReply = { status: 503, error: { code: 'catalog_unavailable', message: 'x', details: { reason: 'timeout' } } };
    await search(page, 'hades');
    await expect(page.getByTestId('add-error')).toContainText('Не удалось выполнить поиск.');
    manual.searchReply = null;
    await page.getByTestId('add-retry').click();
    await expect(page.getByTestId('add-row')).toHaveCount(1);
    await expect(page.getByTestId('add-error')).toHaveCount(0);

    // лимит RAWG: прежние результаты остаются, поле и «Найти» выключены
    manual.searchReply = { status: 503, error: { code: 'catalog_unavailable', message: 'x', details: { reason: 'rate_limited', resetAt: '2026-12-01T21:00:00.000Z' } } };
    await search(page, 'hades 2');
    const quota = page.getByTestId('add-quota');
    await expect(quota).toContainText('Лимит запросов к каталогу исчерпан');
    await expect(quota).toContainText('2 дек.');
    await expect(quota).toHaveAttribute('role', 'status');
    await expect(page.getByTestId('add-input')).toBeDisabled();
    await expect(page.getByTestId('add-submit')).toBeDisabled();
    await expect(page.getByTestId('add-row')).toHaveCount(1);
  });

  test('каталог не настроен и офлайн', async ({ page, context, baseURL }) => {
    const { manual } = await open(page, context, baseURL!, {});
    await addBtn(page).click();
    await page.getByTestId('add-input').fill('hades');
    await context.setOffline(true);
    await page.getByTestId('add-submit').click();
    await expect(page.getByTestId('add-error')).toContainText('Нет соединения. Поиск недоступен офлайн.');
    expect(manual.searchCalls).toEqual([]);
    await context.setOffline(false);
    manual.searchReply = { status: 503, error: { code: 'catalog_unavailable', message: 'x', details: { reason: 'no_key' } } };
    await page.getByTestId('add-submit').click();
    await expect(page.getByTestId('add-unavailable')).toContainText('Каталог игр недоступен');
    await page.getByTestId('add-unavailable').getByRole('button', { name: 'Закрыть' }).click();
    await expect(page.getByRole('dialog', { name: 'Добавить из магазина PS' })).toHaveCount(0);
  });

  test('точки входа: меню страницы и пустой Бэклог', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, {});
    await page.getByRole('button', { name: 'Ещё: действия со страницей' }).click();
    await page.getByTestId('bl-menu-add').click();
    await expect(page.getByRole('dialog', { name: 'Добавить из магазина PS' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(addBtn(page)).toBeFocused();
  });
});

test.describe('Запись «не куплено» в списке', () => {
  test.beforeEach(({ page }) => { void page; });

  test('«Купил» без подтверждения, «Отменить», мета «Ждём первый запуск», фокус на «…»', async ({ page, context, baseURL }) => {
    const { manual } = await open(page, context, baseURL!, { items: [mgame(11, 'Новинка Один', { releaseDate: '2027-02-10' })] });
    const r = row(page, 'Новинка Один');
    await expect(r).toContainText('Выйдет 10 февр. 2027');
    await expect(r.getByTestId('not-purchased')).toBeVisible();
    // фигура статуса □ неинтерактивна, окна игры и «Играть» нет
    await expect(page.getByRole('button', { name: /Начать играть: Новинка/ })).toHaveCount(0);
    await r.getByRole('button', { name: 'Купил: Новинка Один' }).click();
    await expect(r.getByTestId('not-purchased')).toHaveCount(0);
    await expect(r).toContainText('Ждём первый запуск');
    await expect(r.getByRole('button', { name: 'Купил: Новинка Один' })).toHaveCount(0);
    await expect(r.getByRole('button', { name: 'Действия: Новинка Один' })).toBeFocused();
    expect(manual.purchasedCalls).toEqual(['POST 11']);
    const toast = page.getByRole('status').filter({ hasText: 'Пометка снята: «Новинка Один»' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Отменить' }).click();
    expect(manual.purchasedCalls).toEqual(['POST 11', 'DELETE 11']);
    await expect(r.getByTestId('not-purchased')).toBeVisible();
    await expect(r).toContainText('Выйдет 10 февр. 2027');
  });

  test('«Купил» из меню «…»: нет пунктов статуса, есть «Открыть на RAWG»', async ({ page, context, baseURL }) => {
    const { manual } = await open(page, context, baseURL!, { items: [mgame(12, 'Новинка Два')] });
    await page.getByRole('button', { name: 'Действия: Новинка Два' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText([/Купил/, /Открыть на RAWG/, /Убрать из бэклога/]);
    const link = menu.locator('a[role="menuitem"]');
    await expect(link).toHaveAttribute('href', 'https://rawg.io/games/5012');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('target', '_blank');
    await page.getByTestId('np-menu-bought').click();
    expect(manual.purchasedCalls).toEqual(['POST 12']);
    await expect(row(page, 'Новинка Два').getByRole('button', { name: 'Действия: Новинка Два' })).toBeFocused();
  });

  test('ошибка «Купил»: пометка возвращается, тост с «Повторить»', async ({ page, context, baseURL }) => {
    const { manual } = await open(page, context, baseURL!, { items: [mgame(13, 'Новинка Три')] });
    let fail = true;
    await page.route(/\/api\/manual-games\/13\/purchased$/, (route) => {
      if (fail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'internal', message: 'x' } }) });
      return route.fallback();
    });
    const r = row(page, 'Новинка Три');
    await r.getByRole('button', { name: 'Купил: Новинка Три' }).click();
    const toast = page.getByRole('alert').filter({ hasText: 'Не удалось снять пометку. Повтори.' });
    await expect(toast).toBeVisible();
    await expect(r.getByTestId('not-purchased')).toBeVisible();
    fail = false;
    await toast.getByRole('button', { name: 'Повторить' }).click();
    await expect(r.getByTestId('not-purchased')).toHaveCount(0);
    expect(manual.purchasedCalls).toEqual(['POST 13']);
  });

  test('«Убрать из бэклога»: alertdialog, фокус на «Отмена», отмена не удаляет, подтверждение удаляет', async ({ page, context, baseURL }) => {
    const { manual } = await open(page, context, baseURL!, { items: [mgame(14, 'Лишняя Игра'), mgame(15, 'Оставшаяся Игра')] });
    const more = page.getByRole('button', { name: 'Действия: Лишняя Игра' });
    await more.click();
    await page.getByTestId('np-menu-remove').click();
    const dlg = page.getByRole('alertdialog', { name: 'Убрать из бэклога?' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('Игра «Лишняя Игра» исчезнет из списка. Её можно снова добавить через поиск.');
    await expect(page.getByTestId('np-remove-cancel')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(more).toBeFocused();
    expect(manual.removeCalls).toEqual([]);

    await more.click();
    await page.getByTestId('np-menu-remove').click();
    await page.getByTestId('np-remove-cancel').click();
    await expect(dlg).toHaveCount(0);
    expect(manual.removeCalls).toEqual([]);

    await more.click();
    await page.getByTestId('np-menu-remove').click();
    await page.getByTestId('np-remove-confirm').click();
    await expect(dlg).toHaveCount(0);
    expect(manual.removeCalls).toEqual([14]);
    await expect(row(page, 'Лишняя Игра')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Убрано из бэклога: «Лишняя Игра»' })).toBeVisible();
    await expect(row(page, 'Оставшаяся Игра')).toHaveCount(1);
  });

  test('ошибка «Убрать»: диалог остаётся с сообщением', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [mgame(16, 'Упрямая Игра')] });
    await page.route(/\/api\/manual-games\/16$/, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'db_unavailable', message: 'x' } }) }));
    await page.getByRole('button', { name: 'Действия: Упрямая Игра' }).click();
    await page.getByTestId('np-menu-remove').click();
    await page.getByTestId('np-remove-confirm').click();
    await expect(page.getByRole('alertdialog').getByRole('alert')).toContainText('База данных недоступна');
    await expect(row(page, 'Упрямая Игра')).toHaveCount(1);
  });

  test('чип «Не куплено»: фильтр ?nb=1 скрывает игры библиотеки и записи без пометки', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [mgame(21, 'Не Куплена'), mgame(22, 'Куплена Уже', { notPurchased: false })] });
    await expect(page.getByText('Альфа Экшен').first()).toBeVisible();
    await expect(row(page, 'Куплена Уже')).toContainText('Ждём первый запуск');
    if (isMobile(page)) {
      await page.getByRole('button', { name: /^Фильтры и сортировка/ }).click();
      await page.getByRole('dialog', { name: 'Фильтры и сортировка' }).getByTestId('bl-nb-chip').click();
      await page.keyboard.press('Escape');
    } else {
      await page.getByTestId('bl-nb-chip').click();
    }
    await expect(page).toHaveURL(/nb=1/);
    await expect(row(page, 'Не Куплена')).toHaveCount(1);
    await expect(row(page, 'Куплена Уже')).toHaveCount(0);
    await expect(page.getByText('Альфа Экшен')).toHaveCount(0);
    await expect(page.getByTestId('bl-nb-count')).toHaveText('1');
  });

  test('прямая ссылка ?nb=1', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [mgame(23, 'Одна Запись')] }, '/backlog?nb=1');
    await expect(row(page, 'Одна Запись')).toHaveCount(1);
    await expect(page.getByText('Альфа Экшен')).toHaveCount(0);
  });

  test('на старой схеме (503) страница работает, записей нет', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { listReply: { status: 503, error: { code: 'db_unavailable', message: 'x' } } });
    await expect(page.getByText('Альфа Экшен').first()).toBeVisible();
    await expect(addBtn(page)).toBeVisible();
    await expect(page.locator('[data-manual]')).toHaveCount(0);
  });

  test('фильтр по жанру прячет записи без данных', async ({ page, context, baseURL }) => {
    test.skip(isMobile(page), 'жанры в sheet; логика покрыта юнит-тестами');
    await open(page, context, baseURL!, { items: [mgame(24, 'Без Жанра')] }, '/backlog?genres=ACTION');
    await expect(row(page, 'Без Жанра')).toHaveCount(0);
  });
});

test.describe('Список и карточки', () => {
  test('вид «Список»: пометка рядом с метой, без кнопки «Играть»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [mgame(31, 'Список Игра')] });
    await page.getByRole('button', { name: 'Список', exact: true }).click();
    const r = page.locator('li.ps-blrow[data-manual]').filter({ hasText: 'Список Игра' });
    await expect(r).toBeVisible();
    await expect(r.getByTestId('not-purchased')).toBeVisible();
    await expect(r.locator('.ps-blrow__hit')).toHaveCount(0);
    await expect(r.getByRole('button', { name: /Купил/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Начать играть: Альфа Экшен' })).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
  });

  test('вид «Карточки»: пометка на обложке, быстрые действия «Купил» и «…»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [mgame(32, 'Карточка Игра')] });
    await page.getByRole('button', { name: 'Карточки', exact: true }).click();
    const c = page.locator('article.ps-card--manual');
    await expect(c).toHaveCount(1);
    await expect(c).toHaveAttribute('aria-label', 'Карточка Игра, бэклог, не куплено, Выйдет 10 февр. 2027');
    await expect(c.locator('.ps-card__cover').getByTestId('not-purchased')).toBeVisible();
    await expect(c.getByRole('button', { name: 'Купил: Карточка Игра' })).toBeVisible();
    await expect(c.locator('.ps-card__hit')).toHaveCount(0);
    await expect(c.locator('.ps-card__glyph')).toHaveAttribute('aria-disabled', 'true');
  });

  for (const w of [320, 360, 412]) {
    test(`${w} px: нет горизонтального скролла со страницей, панелью поиска и листом совпадений`, async ({ page, context, baseURL }) => {
      test.skip(!isMobile(page), 'мобильные ширины');
      await page.setViewportSize({ width: w, height: 700 });
      const matches: MMatch[] = [{ id: 41, title: 'Очень длинное название игры для проверки переноса строк в карточке совпадения', coverUrl: null, notPurchased: true, game: { gameId: 9, name: 'Очень длинное название игры в библиотеке PSN для проверки', imageUrl: null, lastPlayedAt: '2026-10-05T10:00:00.000Z', hours: 3 } }];
      await open(page, context, baseURL!, { items: [mgame(41, 'Очень длинное название игры для проверки переноса строк в карточке совпадения')], candidates: [hades()], matches });
      expect(await noHScroll(page)).toBe(true);
      const head = await page.getByRole('heading', { name: 'Бэклог', level: 1 }).boundingBox();
      const addBox = await addBtn(page).boundingBox();
      expect(head!.x + head!.width).toBeLessThanOrEqual(w);
      expect(addBox!.x + addBox!.width).toBeLessThanOrEqual(w + 0.5);
      await page.getByRole('button', { name: 'Список', exact: true }).click();
      expect(await noHScroll(page)).toBe(true);
      const buy = await page.getByTestId('np-bought').first().boundingBox();
      expect(buy!.height).toBeGreaterThanOrEqual(43.5);
      await addBtn(page).click();
      await search(page, 'hades');
      await expect(page.getByTestId('add-row')).toHaveCount(1);
      const btn = await page.getByTestId('add-pick').boundingBox();
      expect(btn!.height).toBeGreaterThanOrEqual(43.5);
      const seg = await page.getByTestId('add-buy').boundingBox();
      expect(seg!.height).toBeGreaterThanOrEqual(43.5);
      expect(seg!.x + seg!.width).toBeLessThanOrEqual(btn!.x + 0.5);
      if (w <= 400) {
        // сегмент и кнопка выбора уходят под текст
        const title = await page.locator('.ps-add-row__title').boundingBox();
        expect(btn!.y).toBeGreaterThan(title!.y + title!.height - 1);
        expect(btn!.x + btn!.width).toBeLessThanOrEqual(w + 0.5);
      }
      const sheet = await page.getByTestId('add-sheet').boundingBox();
      expect(sheet!.x + sheet!.width).toBeLessThanOrEqual(w + 0.5);
      expect(await noHScroll(page)).toBe(true);
      await page.keyboard.press('Escape');
      await page.getByTestId('inbox-match').click();
      await expect(page.getByTestId('match-card')).toBeVisible();
      expect(await noHScroll(page)).toBe(true);
      const yes = await page.getByTestId('match-yes').boundingBox();
      expect(yes!.height).toBeGreaterThanOrEqual(43.5);
      expect(yes!.x + yes!.width).toBeLessThanOrEqual(w + 0.5);
    });
  }
});

test.describe('«Это та игра?»', () => {
  const m1: MMatch = { id: 51, title: 'Hades', coverUrl: null, notPurchased: true, game: { gameId: 9, name: 'Hades II', imageUrl: null, lastPlayedAt: '2026-10-05T10:00:00.000Z', hours: 3 } };
  const m2: MMatch = { id: 52, title: 'Control', coverUrl: null, notPurchased: false, game: { gameId: 10, name: 'Control Ultimate Edition', imageUrl: null, lastPlayedAt: null, hours: 12 } };

  test('Бэклог: чип со счётчиком, лист, «Нет» и «Да, она», тосты, чип исчезает', async ({ page, context, baseURL }) => {
    const { manual } = await open(page, context, baseURL!, { items: [mgame(51, 'Hades'), mgame(52, 'Control', { notPurchased: false })], matches: [m1, m2] });
    const chip = page.getByTestId('inbox-match');
    await expect(chip).toContainText('Это та игра? 2');
    await expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
    await chip.click();
    const dlg = page.getByRole('dialog', { name: 'Подтверди совпадения' });
    await expect(dlg).toBeVisible();
    const cards = page.getByTestId('match-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText('Ты добавил');
    await expect(cards.first()).toContainText('В библиотеке');
    await expect(cards.first()).toContainText('Последний запуск 5 окт.');
    await expect(cards.nth(1)).toContainText('Играл 12 ч');
    await expect(cards.first().getByTestId('not-purchased')).toBeVisible();
    await expect(cards.first().getByTestId('match-yes')).toHaveAttribute('aria-label', 'Да, это та же игра: Hades и Hades II');
    await expect(cards.first().getByTestId('match-no')).toHaveAttribute('aria-label', 'Нет, это разные игры: Hades и Hades II');
    await cards.first().getByTestId('match-no').click();
    await expect(cards).toHaveCount(1);
    expect(manual.matchCalls).toEqual([{ id: 51, answer: 'no' }]);
    await expect(page.getByRole('status').filter({ hasText: 'Оставили как есть: «Hades»' })).toBeVisible();
    await expect(chip).toContainText('Это та игра? 1');
    await cards.first().getByTestId('match-yes').click();
    await expect(dlg).toHaveCount(0);
    expect(manual.matchCalls).toEqual([{ id: 51, answer: 'no' }, { id: 52, answer: 'yes' }]);
    await expect(page.getByRole('status').filter({ hasText: 'Игра связана: «Control Ultimate Edition»' })).toBeVisible();
    await expect(chip).toHaveCount(0);
    // связанная запись исчезла из списка
    await expect(row(page, 'Control')).toHaveCount(0);
  });

  test('ошибка ответа: карточка остаётся с сообщением, повтор срабатывает; 404 считается успехом', async ({ page, context, baseURL }) => {
    const { manual } = await open(page, context, baseURL!, { items: [mgame(51, 'Hades')], matches: [m1], matchFails: 1 });
    await page.getByTestId('inbox-match').click();
    await page.getByTestId('match-yes').click();
    await expect(page.getByTestId('match-card').getByRole('alert')).toContainText('Не удалось сохранить. Повтори.');
    await expect(page.getByTestId('match-yes')).toBeEnabled();
    manual.matches = [];
    await page.getByTestId('match-yes').click();
    await expect(page.getByRole('dialog', { name: 'Подтверди совпадения' })).toHaveCount(0);
  });

  test('Коллекция: чип в полосе первый, ✕ его не скрывает', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { matches: [m1] }, '/', { matchCount: 1, trophies: 5, trophiesWindow: '24h', isEmpty: false });
    const strip = page.getByTestId('inbox-strip');
    await expect(strip).toBeVisible();
    await expect(strip.locator('li [data-testid^="inbox-"]').first()).toHaveAttribute('data-testid', 'inbox-match');
    await expect(page.getByTestId('inbox-match')).toContainText('Это та игра? 1');
    await page.getByTestId('inbox-hide').click();
    await expect(page.getByTestId('inbox-trophies')).toHaveCount(0);
    await expect(page.getByTestId('inbox-match')).toBeVisible();
    await expect(page.getByTestId('inbox-hide')).toHaveCount(0);
    await page.getByTestId('inbox-match').click();
    await expect(page.getByTestId('match-card')).toHaveCount(1);
    await page.getByTestId('match-no').click();
    await expect(page.getByTestId('inbox-match')).toHaveCount(0);
  });
});

test.describe('Фаза 48 (п. 11): единое число бэклога', () => {
  test('число бэклога = игры библиотеки; записи вручную подписаны отдельно', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [mgame(21, 'Ручная Один'), mgame(22, 'Ручная Два', { notPurchased: false })] });
    await expect(page.getByTestId('bl-total')).toHaveText('2 в бэклоге · ещё 2 записи вручную, из них 1 не куплено');
    await expect(page.getByTestId('bl-main-count')).toHaveText('2');
  });
});
