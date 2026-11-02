// Фаза 43.1: «Купил / Не купил», мультидобавление (корзина), поле поиска Бэклога, умные подсказки, секция «Не куплено». API эмулируется.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { cand, mgame, mockManual, type ManualMock } from './manual-mock';
import { isMobile } from './backlog-ui';
import { signedSession } from './session';

const bl = (id: number, title: string, o: Partial<G> = {}): G => ({
  id, title, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null, ...o,
});
const games = (): G[] => [bl(1, 'Альфа Экшен'), bl(2, 'Браво Гонки'), bl(3, 'Играю Сейчас', { status: 'playing' })];
const tourStub = JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } });

async function open(page: Page, context: BrowserContext, baseURL: string, o: Partial<ManualMock> = {}, url = '/backlog'): Promise<ManualMock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: tourStub }));
  await page.addInitScript(() => localStorage.setItem('ps-wn-seen:1', '12'));
  await mockApi(page, games());
  const manual = await mockManual(page, o);
  await page.goto(url);
  await page.getByRole('heading', { name: 'Бэклог', level: 1 }).waitFor();
  await page.locator('.ps-card:not(.ps-card--sk), .ps-blrow, .ps-empty').first().waitFor();
  return manual;
}
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const row = (page: Page, title: string) => page.locator('[data-manual]').filter({ hasText: title });
const hades = () => cand('3328', 'Hades II', { releaseDate: '2026-12-05' });
const remix = () => cand('77', 'Hades Remix', { releaseDate: null, platforms: ['PlayStation 4'] });
const many = (n: number) => Array.from({ length: n }, (_, i) => cand(String(900 + i), `Hades Тест ${i + 1}`));

async function search(page: Page, q: string) {
  await page.getByTestId('add-input').fill(q);
  await page.getByTestId('add-submit').click();
}
/** Поле умного поиска: на десктопе строка страницы, на мобильном лист «Поиск». */
async function openSearch(page: Page) {
  if (isMobile(page)) {
    await page.getByTestId('bs-open').click();
    await expect(page.getByRole('dialog', { name: 'Поиск' })).toBeVisible();
  }
  const input = page.getByTestId('bs-input');
  await input.focus();
  return input;
}
const store = (page: Page) => page.locator('[data-testid="bs-opt"][data-kind="store"]');

test.describe('«Купил / Не купил» и корзина', () => {
  test('сегмент по умолчанию «Не купил»; «Купил» уходит без пометки в основной список, «Не купил» в секцию; тост с «Показать»', async ({ page, context, baseURL }) => {
    const manual = await open(page, context, baseURL!, { candidates: [hades(), remix()] });
    await page.getByTestId('bl-add').click();
    await search(page, 'hades');
    const rows = page.getByTestId('add-row');
    await expect(rows).toHaveCount(2);
    const seg = rows.first().getByTestId('add-buy');
    await expect(seg).toHaveAttribute('role', 'radiogroup');
    await expect(seg).toHaveAttribute('aria-label', 'Покупка: Hades II');
    await expect(rows.first().getByTestId('add-buy-no')).toHaveAttribute('aria-checked', 'true');
    await expect(rows.first().getByTestId('add-buy-yes')).toHaveAttribute('aria-checked', 'false');
    await expect(rows.first().getByTestId('add-pick')).toHaveAttribute('aria-pressed', 'false');
    // roving tabindex и стрелки
    await rows.first().getByTestId('add-buy-no').focus();
    await page.keyboard.press('ArrowRight');
    await expect(rows.first().getByTestId('add-buy-yes')).toHaveAttribute('aria-checked', 'true');
    await expect(rows.first().getByTestId('add-buy-yes')).toBeFocused();
    await expect(rows.first().getByTestId('add-buy-no')).toHaveAttribute('tabindex', '-1');
    // «+» только выбирает
    await rows.first().getByTestId('add-pick').click();
    await expect(rows.first().getByTestId('add-pick')).toHaveAttribute('aria-pressed', 'true');
    await rows.nth(1).getByTestId('add-pick').click();
    expect(manual.batchBodies).toHaveLength(0);
    const cart = page.getByTestId('add-cart');
    await expect(cart).toContainText('К добавлению: 2');
    await expect(cart.getByTestId('add-cart-item')).toHaveCount(2);
    // смена сегмента у выбранной игры обновляет корзину
    await rows.nth(1).getByTestId('add-buy-yes').click();
    await rows.nth(1).getByTestId('add-buy-no').click();
    await page.getByTestId('add-cart-submit').click();
    await expect(rows.first().getByTestId('add-row-done')).toHaveText('Добавлено · Купил');
    await expect(rows.nth(1).getByTestId('add-row-done')).toHaveText('Добавлено · Не куплено');
    expect(manual.batchBodies[0].map((b) => [b.externalId, b.notPurchased])).toEqual([['3328', false], ['77', true]]);
    await expect(page.getByTestId('add-cart')).toHaveCount(0);
    await expect(page.getByTestId('add-input')).toBeFocused();
    await page.getByTestId('add-close').click();
    const toast = page.getByRole('status').filter({ hasText: 'Добавлено в бэклог: 2, из них куплено: 1' });
    await expect(toast).toBeVisible();
    // «Купил»: без пометки, мета «Ждём первый запуск», в основном списке (не в секции)
    const bought = row(page, 'Hades II');
    await expect(bought.getByTestId('not-purchased')).toHaveCount(0);
    await expect(bought).toContainText('Ждём первый запуск');
    await expect(page.getByTestId('bl-nb').locator('[data-manual]')).toHaveCount(1);
    await expect(page.getByTestId('bl-nb').locator('[data-manual]')).toContainText('Hades Remix');
    await expect(page.getByTestId('bl-nb').locator('[data-manual]').getByTestId('not-purchased')).toBeVisible();
    await toast.getByRole('button', { name: 'Показать' }).click();
    await expect(page.locator('#h-bl-nb')).toBeFocused();
  });

  test('тост с одной игрой «Купил» без действия «Показать»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { candidates: [hades()] });
    await page.getByTestId('bl-add').click();
    await search(page, 'hades');
    await page.getByTestId('add-buy-yes').click();
    await page.getByTestId('add-pick').click();
    await page.getByTestId('add-cart-submit').click();
    await page.getByTestId('add-close').click();
    const toast = page.getByRole('status').filter({ hasText: 'Добавлено в бэклог: «Hades II»' });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Показать' })).toHaveCount(0);
    await expect(page.getByTestId('bl-nb')).toHaveCount(0);
  });

  test('частичный успех: баннер, дубль, ошибка элемента; в корзине остаются неудавшиеся', async ({ page, context, baseURL }) => {
    const manual = await open(page, context, baseURL!, {
      candidates: [hades(), remix(), cand('5', 'Hades Три')], batchDup: ['77'], batchFail: { '5': 'manual_limit' },
    });
    await page.getByTestId('bl-add').click();
    await search(page, 'hades');
    for (let i = 0; i < 3; i++) await page.getByTestId('add-row').nth(i).getByTestId('add-pick').click();
    await expect(page.getByTestId('add-cart-submit')).toHaveText('Добавить 3');
    await page.getByTestId('add-cart-submit').click();
    const banner = page.getByTestId('add-cart-banner');
    await expect(banner).toHaveText('Добавлено 1 из 3. Остальные: исправь или убери.');
    await expect(banner).toBeFocused();
    await expect(page.getByTestId('add-cart-item')).toHaveCount(2);
    await expect(page.getByTestId('add-warn')).toContainText('Такая игра уже есть');
    await expect(page.getByTestId('add-cart-item').filter({ hasText: 'Hades Три' }).getByRole('alert')).toContainText('уже 200 игр');
    // дубль исключён из счётчика
    await expect(page.getByTestId('add-cart-submit')).toHaveText('Добавить 1');
    await expect(page.getByTestId('add-row').first().getByTestId('add-row-done')).toHaveText('Добавлено · Не куплено');
    await expect(page.getByTestId('add-row').nth(1).getByTestId('add-row-need')).toBeVisible();
    // исправили: убрали ошибочный элемент крестиком
    await page.getByTestId('add-cart-item').filter({ hasText: 'Hades Три' }).getByTestId('add-cart-remove').click();
    await page.getByTestId('add-warn-confirm').click();
    await expect(page.getByTestId('add-cart')).toHaveCount(0);
    await expect(page.getByTestId('add-input')).toBeFocused();
    expect(manual.items.map((i) => i.externalId).sort()).toEqual(['3328', '77']);
  });

  test('лимит пачки 10: остальные «+» выключены, подпись «Максимум 10 за раз»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { candidates: many(12) });
    await page.getByTestId('bl-add').click();
    await search(page, 'hades');
    await expect(page.getByTestId('add-row')).toHaveCount(12);
    for (let i = 0; i < 10; i++) await page.getByTestId('add-row').nth(i).getByTestId('add-pick').click();
    const eleventh = page.getByTestId('add-row').nth(10).getByTestId('add-pick');
    await expect(eleventh).toBeDisabled();
    await expect(eleventh).toHaveAttribute('aria-label', 'Лимит: 10 игр за раз');
    await expect(page.getByTestId('add-cart')).toContainText('Максимум 10 за раз');
    await expect(page.getByTestId('add-cart-submit')).toHaveText('Добавить 10');
    // раскрыто по умолчанию только пока N <= 3: теперь свёрнуто, раскрывается кнопкой
    await expect(page.getByTestId('add-cart-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('add-cart-toggle').click();
    await expect(page.getByTestId('add-cart-item')).toHaveCount(10);
    await page.getByTestId('add-cart-clear').click();
    await expect(page.getByTestId('add-cart')).toHaveCount(0);
  });

  test('закрытие с непустой корзиной: подтверждение, «Вернуться» и «Закрыть без добавления»', async ({ page, context, baseURL }) => {
    const manual = await open(page, context, baseURL!, { candidates: [hades()] });
    await page.getByTestId('bl-add').click();
    await search(page, 'hades');
    await page.getByTestId('add-pick').click();
    await page.getByTestId('add-close').click();
    const dlg = page.getByTestId('add-close-confirm');
    await expect(dlg).toHaveAttribute('role', 'alertdialog');
    await expect(dlg).toContainText('Выбрано 1 игра, они ещё не добавлены.');
    await expect(page.getByTestId('add-close-back')).toBeFocused();
    await page.getByTestId('add-close-back').click();
    await expect(dlg).toHaveCount(0);
    await expect(page.getByTestId('add-cart')).toContainText('К добавлению: 1');
    await page.keyboard.press('Escape');
    await page.getByTestId('add-close-discard').click();
    await expect(page.getByRole('dialog', { name: 'Добавить из магазина PS' })).toHaveCount(0);
    expect(manual.batchBodies).toHaveLength(0);
    await expect(page.getByTestId('bl-add')).toBeFocused();
  });

  test('офлайн: «Добавить N» выключена с подписью; без соединения запрос не уходит', async ({ page, context, baseURL }) => {
    const manual = await open(page, context, baseURL!, { candidates: [hades()] });
    await page.getByTestId('bl-add').click();
    await search(page, 'hades');
    await page.getByTestId('add-pick').click();
    await context.setOffline(true);
    await expect(page.getByTestId('add-cart-submit')).toBeDisabled();
    await expect(page.getByTestId('add-cart')).toContainText('Нет соединения');
    await context.setOffline(false);
    await expect(page.getByTestId('add-cart-submit')).toBeEnabled();
    expect(manual.batchBodies).toHaveLength(0);
  });
});

test.describe('Секция «Не куплено»', () => {
  const nb = (id: number, title: string, o = {}) => mgame(id, title, o);

  test('под основным списком, пунктирная рамка, вкладка в bl-jump, «Показать ещё», сворачивание сохраняется', async ({ page, context, baseURL }) => {
    const items = Array.from({ length: 14 }, (_, i) => nb(200 + i, `Новинка ${String(i + 1).padStart(2, '0')}`));
    await open(page, context, baseURL!, { items: [...items, nb(300, 'Уже Куплена', { notPurchased: false })] });
    const sec = page.getByTestId('bl-nb');
    await expect(sec).toBeVisible();
    await expect(page.getByTestId('bl-nb-count')).toHaveText('14');
    // не в основном списке: игры «не куплено» только в секции
    await expect(page.locator('.ps-bl-list [data-manual]')).toHaveCount(1);
    await expect(page.locator('.ps-bl-list [data-manual]')).toContainText('Уже Куплена');
    // ниже основного списка
    const main = await page.locator('.ps-bl-list').boundingBox();
    const secBox = await sec.boundingBox();
    expect(secBox!.y).toBeGreaterThan(main!.y + main!.height - 1);
    // пунктирная рамка, не жёлтая (токен --nb-sec-border = --nb-border)
    const style = await sec.evaluate((el) => { const c = getComputedStyle(el); return { s: c.borderTopStyle, w: c.borderTopWidth, col: c.borderTopColor }; });
    expect(style.s).toBe('dashed');
    expect(style.w).toBe('1px');
    const warning = await page.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--warning)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; });
    expect(style.col).not.toBe(warning);
    await expect(sec.getByRole('heading', { level: 2, name: /Не куплено/ })).toBeVisible();
    // вкладка в липкой плашке
    const tab = page.getByTestId('bl-jump').getByRole('button', { name: /Не куплено/ });
    await expect(tab).toContainText('14');
    await tab.click();
    await expect(page.locator('#h-bl-nb')).toBeFocused();
    // до 12, остальное по «Показать ещё» без запроса
    await expect(sec.locator('[data-manual]')).toHaveCount(12);
    const calls = await page.evaluate(() => performance.getEntriesByType('resource').length);
    await page.getByTestId('bl-nb-more').click();
    await expect(sec.locator('[data-manual]')).toHaveCount(14);
    expect(await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => r.name.includes('manual-games')).length)).toBeLessThanOrEqual(calls);
    // сворачивание
    const toggle = page.getByTestId('bl-nb-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(sec.locator('[data-manual]')).toHaveCount(0);
    await expect(page.getByTestId('bl-nb-count')).toHaveText('14');
    expect(await page.evaluate(() => localStorage.getItem('ps.bl.nb.open'))).toBe('0');
    await page.reload();
    await expect(page.getByTestId('bl-nb-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(await noHScroll(page)).toBe(true);
  });

  test('localStorage недоступен: секция работает, развёрнута по умолчанию', async ({ page, context, baseURL }) => {
    await page.addInitScript(() => {
      const bad = () => { throw new DOMException('denied', 'SecurityError'); };
      const orig = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k: string) { if (k === 'ps.bl.nb.open') return bad(); return orig.call(this, k); };
      const origSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) { if (k === 'ps.bl.nb.open') return bad(); return origSet.call(this, k, v); };
    });
    await open(page, context, baseURL!, { items: [nb(1, 'Одна Игра')] });
    await expect(page.getByTestId('bl-nb-toggle')).toHaveAttribute('aria-expanded', 'true');
    await page.getByTestId('bl-nb-toggle').click();
    await expect(page.getByTestId('bl-nb-toggle')).toHaveAttribute('aria-expanded', 'false');
  });

  test('«Купил» из секции: запись уходит в основной список, число обновляется; когда все куплены, остаётся «Всё куплено»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [nb(11, 'Первая Новинка'), nb(12, 'Вторая Новинка')] });
    const sec = page.getByTestId('bl-nb');
    await expect(page.getByTestId('bl-nb-count')).toHaveText('2');
    await sec.getByRole('button', { name: 'Купил: Первая Новинка' }).click();
    await expect(page.getByTestId('bl-nb-count')).toHaveText('1');
    await expect(sec.locator('[data-manual]')).toHaveCount(1);
    const moved = page.locator('.ps-bl-list [data-manual]').filter({ hasText: 'Первая Новинка' });
    await expect(moved).toHaveCount(1);
    await expect(moved.getByTestId('not-purchased')).toHaveCount(0);
    await expect(moved.getByRole('button', { name: 'Действия: Первая Новинка' })).toBeFocused();
    await sec.getByRole('button', { name: 'Купил: Вторая Новинка' }).click();
    await expect(page.getByTestId('bl-nb-empty')).toContainText('Всё куплено');
    await expect(page.getByTestId('bl-nb-count')).toHaveText('0');
  });

  test('без записей «не куплено» секции нет', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [] });
    await expect(page.getByTestId('bl-nb')).toHaveCount(0);
    await expect(page.getByTestId('bl-jump').getByRole('button', { name: /Не куплено/ })).toHaveCount(0);
  });

  test('секция в режиме «Список» на мобильном: нет горизонтального скролла 320-412', async ({ page, context, baseURL }) => {
    test.skip(!isMobile(page), 'мобильные ширины');
    for (const w of [320, 360, 412]) {
      await page.setViewportSize({ width: w, height: 700 });
      if (w === 320) await open(page, context, baseURL!, { items: [nb(1, 'Очень длинное название игры для проверки переноса строк в секции «Не куплено» на узком экране')] });
      await page.getByRole('button', { name: 'Список', exact: true }).click();
      expect(await noHScroll(page), String(w)).toBe(true);
      const box = await page.getByTestId('bl-nb').boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(w + 0.5);
    }
  });
});

test.describe('Поиск по Бэклогу (?q=)', () => {
  test('фильтр применяется по Enter: библиотека через GET /api/games?q=, записи локально; сброс', async ({ page, context, baseURL }) => {
    test.skip(isMobile(page), 'мобильный вариант ниже');
    await open(page, context, baseURL!, { items: [mgame(1, 'Альфа Новинка'), mgame(2, 'Другая Новинка')] });
    const input = page.getByTestId('bs-input');
    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).toHaveAttribute('placeholder', 'Поиск по списку и магазину PS');
    await input.fill('альф');
    await input.press('Enter');
    await expect(page).toHaveURL(/q=%D0%B0%D0%BB%D1%8C%D1%84/);
    await expect(page.getByText('Браво Гонки')).toHaveCount(0);
    await expect(page.getByText('Альфа Экшен').first()).toBeVisible();
    await expect(row(page, 'Альфа Новинка')).toHaveCount(1);
    await expect(row(page, 'Другая Новинка')).toHaveCount(0);
    await expect(page.getByTestId('bl-nb-count')).toHaveText('1');
    await expect(input).toHaveValue('альф');
    await page.getByTestId('bs-clear').click();
    await expect(page).not.toHaveURL(/q=/);
    await expect(page.getByText('Браво Гонки').first()).toBeVisible();
    // нет совпадений: «Ничего не найдено» со сбросом
    await input.fill('яяяя');
    await input.press('Enter');
    await expect(page.getByRole('heading', { name: 'Ничего не найдено' })).toBeVisible();
    await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
    await expect(input).toHaveValue('');
    await expect(page).not.toHaveURL(/q=/);
  });

  test('мобильный: иконка в полосе, лист «Поиск», строка «Поиск: «…» Сбросить»; высота полосы не меняется', async ({ page, context, baseURL }) => {
    test.skip(!isMobile(page), 'иконка только на мобильном');
    await open(page, context, baseURL!, { items: [mgame(1, 'Альфа Новинка')] });
    const barH = (await page.locator('.ps-bl-bar').boundingBox())!.height;
    const icon = page.getByTestId('bs-open');
    await expect(icon).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(icon).toHaveAttribute('aria-label', 'Поиск по бэклогу');
    const ib = (await icon.boundingBox())!;
    expect(ib.width).toBeGreaterThanOrEqual(39.5);
    await expect(page.getByTestId('bs-active')).toHaveCount(0);
    await icon.click();
    const dlg = page.getByRole('dialog', { name: 'Поиск' });
    await expect(dlg).toBeVisible();
    await expect(page.getByTestId('bs-input')).toBeFocused();
    const h = (await dlg.boundingBox())!.height;
    expect(h).toBeGreaterThan(page.viewportSize()!.height * 0.85);
    await page.getByTestId('bs-input').fill('альф');
    await page.getByTestId('bs-input').press('Enter');
    await expect(dlg).toHaveCount(0);
    await expect(page).toHaveURL(/q=/);
    await expect(page.getByTestId('bs-active')).toContainText('Поиск: «альф»');
    await expect(icon).toHaveAttribute('data-active', 'true');
    await expect(icon).toHaveAttribute('aria-label', 'Поиск по бэклогу, задан запрос');
    expect((await page.locator('.ps-bl-bar').boundingBox())!.height).toBeCloseTo(barH, 0);
    await page.getByTestId('bs-active').getByRole('button', { name: 'Сбросить' }).click();
    await expect(page).not.toHaveURL(/q=/);
    await expect(page.getByTestId('bs-active')).toHaveCount(0);
  });

  test('прямая ссылка ?q= применяется сразу', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, {}, '/backlog?q=%D0%B1%D1%80%D0%B0%D0%B2%D0%BE');
    await expect(page.getByText('Браво Гонки').first()).toBeVisible();
    await expect(page.getByText('Альфа Экшен')).toHaveCount(0);
  });
});

test.describe('Умные подсказки', () => {
  test('меньше 3 символов: запроса нет, есть подсказка «Введи ещё»; локальный список с 1 символа', async ({ page, context, baseURL }) => {
    const manual = await open(page, context, baseURL!, { candidates: [hades()], items: [mgame(1, 'Альфа Новинка')] });
    const input = await openSearch(page);
    await input.fill('а');
    await expect(page.getByTestId('bs-local')).toContainText('Альфа Экшен');
    await expect(page.getByTestId('bs-state').filter({ hasText: 'Введи ещё 2 символа для поиска в магазине PS' })).toBeVisible();
    await input.fill('ха');
    await expect(page.getByTestId('bs-state').filter({ hasText: 'Введи ещё 1 символ для поиска в магазине PS' })).toBeVisible();
    await expect(page.getByTestId('bs-state').filter({ hasText: 'В списке нет совпадений' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(manual.suggestCalls).toEqual([]);
  });

  test('debounce 350 мс: запрос не на каждый символ; повтор того же запроса из кэша', async ({ page, context, baseURL }) => {
    const manual = await open(page, context, baseURL!, { candidates: [hades(), remix()] });
    const input = await openSearch(page);
    await input.pressSequentially('hades', { delay: 60 });
    await expect(store(page)).toHaveCount(2);
    expect(manual.suggestCalls).toEqual(['hades']);
    await input.fill('');
    await input.fill('hades');
    await expect(store(page)).toHaveCount(2);
    await page.waitForTimeout(500);
    expect(manual.suggestCalls).toEqual(['hades']);
  });

  test('отмена устаревшего запроса: результат прежнего ввода не показывается', async ({ page, context, baseURL }) => {
    const manual = await open(page, context, baseURL!, {
      candidates: [hades(), cand('1', 'Hadean Старое')], suggestDelays: { had: 1500 },
    });
    const input = await openSearch(page);
    await input.fill('had');
    await page.waitForTimeout(600); // запрос 'had' ушёл и ждёт ответа
    expect(manual.suggestCalls).toEqual(['had']);
    await input.fill('hades');
    await expect(store(page)).toHaveCount(1);
    await expect(store(page)).toContainText('Hades II');
    await page.waitForTimeout(1400); // ответ на 'had' доходит позже и игнорируется
    await expect(store(page)).toHaveCount(1);
    await expect(page.getByText('Hadean Старое')).toHaveCount(0);
    expect(manual.suggestCalls).toEqual(['had', 'hades']);
  });

  test('загрузка: скелет с резервом высоты, aria-busy; результаты: подсветка, мета, «Все результаты»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { candidates: [hades(), remix()], suggestDelays: { hades: 700 } });
    const input = await openSearch(page);
    await input.fill('hades');
    const sk = page.getByTestId('bs-state').filter({ has: page.locator('.ps-bs-sk') });
    await expect(sk).toHaveAttribute('aria-busy', 'true');
    expect((await sk.boundingBox())!.height).toBeGreaterThanOrEqual(167);
    await expect(store(page)).toHaveCount(2);
    await expect(store(page).first().locator('mark.ps-hl')).toHaveText('Hades');
    await expect(store(page).first()).toContainText('Релиз 5 дек. 2026 · PS5 · PS4');
    await expect(page.getByTestId('bs-more')).toHaveText('Все результаты в магазине PS');
    await expect(page.getByTestId('bs-store')).toHaveAttribute('role', 'group');
    await expect(page.getByTestId('bs-pop').getByRole('listbox', { name: 'Результаты поиска' })).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
  });

  test('не больше 5 подсказок из магазина', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { candidates: many(8) });
    const input = await openSearch(page);
    await input.fill('hades');
    await expect(store(page)).toHaveCount(isMobile(page) ? 8 : 5);
  });

  test('клавиатура и ARIA: стрелки без зацикливания, aria-activedescendant, Enter добавляет «Не куплено», Esc и Tab', async ({ page, context, baseURL }) => {
    const manual = await open(page, context, baseURL!, { candidates: [hades(), remix()] });
    const input = await openSearch(page);
    await expect(input).toHaveAttribute('aria-haspopup', 'listbox');
    await expect(input).toHaveAttribute('aria-autocomplete', 'list');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await input.fill('hades');
    await expect(store(page)).toHaveCount(2);
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    const list = page.getByTestId('bs-pop').getByRole('listbox');
    await expect(input).toHaveAttribute('aria-controls', (await list.getAttribute('id'))!);
    await input.press('ArrowDown');
    const first = store(page).first();
    await expect(input).toHaveAttribute('aria-activedescendant', (await first.getAttribute('id'))!);
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(first).toHaveAttribute('aria-label', 'Hades II, из магазина PS, нажми Enter, чтобы добавить как «не куплено»');
    await input.press('ArrowDown');
    await input.press('ArrowDown');
    const more = page.getByTestId('bs-more');
    await expect(more).toHaveAttribute('aria-selected', 'true');
    await input.press('ArrowDown'); // край: не зацикливается
    await expect(more).toHaveAttribute('aria-selected', 'true');
    await input.press('ArrowUp');
    await input.press('ArrowUp');
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(input).toBeFocused(); // фокус DOM остаётся в поле
    await input.press('Enter');
    await expect(first).toContainText('Добавлено · Не куплено');
    expect(manual.addBodies).toHaveLength(1);
    expect(manual.addBodies[0]).toMatchObject({ externalId: '3328', title: 'Hades II' });
    expect(manual.addBodies[0].notPurchased).not.toBe(false); // по умолчанию «Не куплено»
    const toast = page.getByRole('status').filter({ hasText: 'Добавлено в бэклог: «Hades II»' });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Показать' })).toBeVisible();
    await expect(page.getByTestId('bl-nb').locator('[data-manual]')).toHaveCount(1);
    // добавленная опция остаётся и повторно не добавляется
    await first.click({ force: true });
    await input.press('Enter');
    expect(manual.addBodies).toHaveLength(1);
    if (!isMobile(page)) {
      // Esc: сначала закрывает popup, значение остаётся; второй Esc очищает поле
      await input.press('Escape');
      await expect(page.getByTestId('bs-pop')).toHaveCount(0);
      await expect(input).toHaveValue('hades');
      await input.press('ArrowDown');
      await expect(page.getByTestId('bs-pop')).toBeVisible();
      await input.press('Tab');
      await expect(page.getByTestId('bs-pop')).toHaveCount(0);
      await input.focus();
      await input.press('Escape');
      await input.press('Escape');
      await expect(input).toHaveValue('');
    }
  });

  test('«Все результаты в магазине PS» открывает панель и запускает явный поиск', async ({ page, context, baseURL }) => {
    const manual = await open(page, context, baseURL!, { candidates: [hades(), remix()] });
    const input = await openSearch(page);
    await input.fill('hades');
    await expect(store(page)).toHaveCount(2);
    await page.getByTestId('bs-more').click();
    const dlg = page.getByRole('dialog', { name: 'Добавить из магазина PS' });
    await expect(dlg).toBeVisible();
    await expect(page.getByTestId('add-input')).toHaveValue('hades');
    await expect(page.getByTestId('add-row')).toHaveCount(2);
    expect(manual.searchCalls).toEqual(['hades']);
  });

  test('мягкий предел (suggest_limited): подсказки отключены до resetAt, Enter открывает поиск в магазине', async ({ page, context, baseURL }) => {
    const manual = await open(page, context, baseURL!, {
      candidates: [hades()], suggestReply: { status: 429, error: { code: 'rate_limited', message: 'x', details: { reason: 'suggest_limited', resetAt: '2099-01-01T21:00:00.000Z' } } },
    });
    const input = await openSearch(page);
    await input.fill('hades');
    const st = page.getByTestId('bs-state').filter({ hasText: 'Подсказки из магазина отключены, чтобы не тратить лимит' });
    await expect(st).toBeVisible();
    await expect(st).toContainText('Нажми Enter, чтобы найти в магазине PS.');
    await expect(st).toHaveAttribute('role', 'status');
    await expect(page.locator('.ps-bs-sk')).toHaveCount(0);
    await input.fill('hadesx');
    await input.fill('hades');
    await page.waitForTimeout(500);
    expect(manual.suggestCalls).toEqual(['hades']); // больше не стучимся
    await input.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Добавить из магазина PS' })).toBeVisible();
    await expect(page.getByTestId('add-input')).toHaveValue('hades');
    await expect(page.getByTestId('add-row')).toHaveCount(1);
    expect(manual.searchCalls).toEqual(['hades']);
  });

  test('квота RAWG (quota): подсказки и Enter-поиск остановлены, Enter только применяет фильтр', async ({ page, context, baseURL }) => {
    const manual = await open(page, context, baseURL!, {
      candidates: [hades()], suggestReply: { status: 429, error: { code: 'rate_limited', message: 'x', details: { reason: 'quota', resetAt: '2099-01-01T21:00:00.000Z' } } },
    });
    const input = await openSearch(page);
    await input.fill('hades');
    const st = page.getByTestId('bs-state').filter({ hasText: 'Лимит запросов к каталогу исчерпан. Подсказки из магазина вернутся позже.' });
    await expect(st).toBeVisible();
    await expect(st).toHaveAttribute('role', 'status');
    await input.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Добавить из магазина PS' })).toHaveCount(0);
    await expect(page).toHaveURL(/q=hades/);
    expect(manual.suggestCalls).toEqual(['hades']);
    // панель поиска по Enter тоже остановлена до resetAt
    if (isMobile(page)) await page.keyboard.press('Escape');
    await page.getByTestId('bl-add').click();
    await expect(page.getByTestId('add-quota')).toBeVisible();
    await expect(page.getByTestId('add-input')).toBeDisabled();
    expect(manual.searchCalls).toEqual([]);
  });

  test('ошибка подсказок: сообщение и опция «Повторить»; повтор получает результаты', async ({ page, context, baseURL }) => {
    const manual = await open(page, context, baseURL!, {
      candidates: [hades()], suggestReply: { status: 503, error: { code: 'catalog_unavailable', message: 'x', details: { reason: 'timeout' } } },
    });
    const input = await openSearch(page);
    await input.fill('hades');
    await expect(page.getByTestId('bs-state').filter({ hasText: 'Не удалось получить подсказки.' })).toHaveAttribute('role', 'alert');
    const retry = page.getByTestId('bs-retry');
    await expect(retry).toHaveAttribute('role', 'option');
    manual.suggestReply = null;
    await input.press('ArrowDown');
    await expect(retry).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(store(page)).toHaveCount(1);
    expect(manual.suggestCalls).toEqual(['hades', 'hades']);
  });

  test('офлайн: сообщение, запросы не уходят, локальный список работает', async ({ page, context, baseURL }) => {
    const manual = await open(page, context, baseURL!, { candidates: [hades()] });
    const input = await openSearch(page);
    await context.setOffline(true);
    await input.fill('альф');
    await expect(page.getByTestId('bs-state').filter({ hasText: 'Нет соединения. Подсказки из магазина недоступны, список ищется как обычно.' })).toBeVisible();
    await expect(page.getByTestId('bs-local')).toContainText('Альфа Экшен');
    await page.waitForTimeout(500);
    expect(manual.suggestCalls).toEqual([]);
    await context.setOffline(false);
  });

  test('каталог не настроен: секция магазина скрыта целиком, локальная часть работает', async ({ page, context, baseURL }) => {
    const manual = await open(page, context, baseURL!, { candidates: [hades()], suggestReply: { status: 503, error: { code: 'catalog_unavailable', message: 'x', details: { reason: 'no_key' } } } });
    const input = await openSearch(page);
    await input.fill('альфа');
    await expect(page.getByTestId('bs-local')).toContainText('Альфа Экшен');
    await expect(page.getByTestId('bs-store')).toHaveCount(0);
    await expect(page.getByTestId('bs-state').filter({ hasText: 'магазин' })).toHaveCount(0);
    expect(manual.suggestCalls).toEqual(['альфа']);
    await input.fill('альфаб');
    await page.waitForTimeout(500);
    expect(manual.suggestCalls).toEqual(['альфа']);
  });

  test('нет результатов: «Ничего не найдено по «…»», в магазине без совпадений при наличии локальных', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { candidates: [] });
    const input = await openSearch(page);
    await input.fill('zzzz');
    const none = page.getByTestId('bs-state').filter({ hasText: 'Ничего не найдено по «zzzz»' });
    await expect(none).toBeVisible();
    await expect(none).toContainText('Нажми Enter, чтобы применить фильтр по списку');
    await input.fill('альфа');
    await expect(page.getByTestId('bs-local')).toContainText('Альфа Экшен');
    await expect(page.getByTestId('bs-state').filter({ hasText: 'В магазине нет игр для PS5 и PS4 по «альфа»' })).toBeVisible();
  });

  test('«Из списка»: выбор игры прокручивает к ней и ставит фокус; запись «не куплено» раскрывает свёрнутую секцию', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [mgame(1, 'Альфа Новинка'), mgame(2, 'Другая Новинка')] });
    await page.getByTestId('bl-nb-toggle').click();
    await expect(page.getByTestId('bl-nb-toggle')).toHaveAttribute('aria-expanded', 'false');
    const input = await openSearch(page);
    await input.fill('другая');
    await expect(page.getByTestId('bs-local')).toContainText('Другая Новинка');
    await expect(page.getByTestId('bs-local').getByTestId('not-purchased')).toBeVisible();
    await input.press('ArrowDown');
    await input.press('Enter');
    await expect(page.getByTestId('bl-nb-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(row(page, 'Другая Новинка').getByRole('button', { name: 'Купил: Другая Новинка' })).toBeFocused();
    // игра библиотеки
    const input2 = await openSearch(page);
    await input2.fill('браво');
    await expect(page.getByTestId('bs-local')).toContainText('Браво Гонки');
    await input2.press('ArrowDown');
    await input2.press('Enter');
    await expect(page.locator('[data-game="2"]')).toBeVisible();
    await expect(page.locator('[data-game="2"]').locator('.ps-card__hit, .ps-blrow__hit')).toBeFocused();
  });

  test('живая область объявляет итог один раз, после загрузки обоих источников', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { candidates: [hades(), remix()], suggestDelays: { hades: 400 } });
    const input = await openSearch(page);
    const live = page.getByTestId('bs-live');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await input.fill('hades');
    await expect(live).toHaveText('');
    await expect(live).toHaveText('Из списка: 0. Из магазина PS: 2.');
  });

  for (const w of [320, 360, 412]) {
    test(`${w} px: подсказки не дают горизонтального скролла, тап-зоны >= 44 в листе`, async ({ page, context, baseURL }) => {
      test.skip(!isMobile(page), 'мобильные ширины');
      await page.setViewportSize({ width: w, height: 700 });
      await open(page, context, baseURL!, { candidates: [cand('1', 'Очень длинное название игры из магазина PS для проверки обрезки строки в подсказке', { releaseDate: '2026-12-05' })] });
      const input = await openSearch(page);
      expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
      await input.fill('очень');
      await input.fill('очень длинное');
      await expect(page.getByTestId('bs-local')).toHaveCount(0);
      await page.getByTestId('bs-input').fill('длинное');
      await expect(store(page)).toHaveCount(1);
      const plus = await page.getByTestId('bs-opt-add').boundingBox();
      expect(plus!.height).toBeGreaterThanOrEqual(43.5);
      expect(plus!.x + plus!.width).toBeLessThanOrEqual(w + 0.5);
      expect(await noHScroll(page)).toBe(true);
    });
  }
});

test.describe('Панель поиска: строки и тап-зоны', () => {
  test('сегмент и «+» помещаются, высота строки не меняется при выборе (CLS)', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { candidates: [hades()] });
    await page.getByTestId('bl-add').click();
    await search(page, 'hades');
    const r = page.getByTestId('add-row');
    const before = (await r.boundingBox())!.height;
    await page.getByTestId('add-pick').click();
    const after = (await r.boundingBox())!.height;
    expect(after).toBeCloseTo(before, 0);
    expect(await noHScroll(page)).toBe(true);
    await page.getByTestId('add-buy-yes').click();
    expect((await r.boundingBox())!.height).toBeCloseTo(before, 0);
  });
});

test.describe('QA-43.1-2: «Купил» для игры, уже лежащей в «Не куплено»', () => {
  test('exists + «Купил» вызывает /purchased и показывает явный текст', async ({ page, context, baseURL }) => {
    const manual = await open(page, context, baseURL!, { candidates: [hades()], items: [mgame(21, 'Hades II', { externalId: '3328' })] });
    await page.getByTestId('bl-add').click();
    await search(page, 'hades');
    const r = page.getByTestId('add-row').first();
    await r.getByTestId('add-buy-yes').click();
    await r.getByTestId('add-pick').click();
    await page.getByTestId('add-cart-submit').click();
    await expect(r.getByTestId('add-row-done')).toHaveText('Уже в бэклоге · отмечено «Купил»');
    expect(manual.purchasedCalls).toEqual(['POST 21']);
    await page.getByTestId('add-close').click();
    await expect(page.getByRole('status').filter({ hasText: 'Отмечено «Купил»: «Hades II»' })).toBeVisible();
  });
  test('exists + «Не купил»: /purchased не вызывается', async ({ page, context, baseURL }) => {
    const manual = await open(page, context, baseURL!, { candidates: [hades()], items: [mgame(21, 'Hades II', { externalId: '3328' })] });
    await page.getByTestId('bl-add').click();
    await search(page, 'hades');
    const r = page.getByTestId('add-row').first();
    await r.getByTestId('add-pick').click();
    await page.getByTestId('add-cart-submit').click();
    await expect(r.getByTestId('add-row-done')).toHaveText('Уже в бэклоге');
    expect(manual.purchasedCalls).toEqual([]);
  });
});
