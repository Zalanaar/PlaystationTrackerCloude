// Фаза 44: «Играл на другой платформе» (design-system §19c). API эмулируется (other-platform-mock.ts).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { mockManual } from './manual-mock';
import { mockOtherPlatforms, ocand, op, type OPMock } from './other-platform-mock';
import { isMobile } from './backlog-ui';
import { signedSession } from './session';

const lib = (): G[] => [{ id: 1, title: 'Альфа Экшен', lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null }];
const tourStub = JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } });
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function open(page: Page, context: BrowserContext, baseURL: string, o: Partial<OPMock> = {}, url = '/other-platforms'): Promise<OPMock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: tourStub }));
  await page.addInitScript(() => localStorage.setItem('ps-wn-seen:1', '12'));
  await mockApi(page, lib());
  await mockManual(page); // Бэклог: пустые записи ps_backlog
  const m = await mockOtherPlatforms(page, o);
  await page.goto(url);
  if (url === '/other-platforms') await page.getByRole('heading', { name: 'Играл на другой платформе', level: 1 }).waitFor();
  else await page.locator('main').waitFor();
  return m;
}
const rows = (page: Page) => page.getByTestId('op-row');
const many = (n: number) => Array.from({ length: n }, (_, i) => op(i + 1, `Игра ${String(i + 1).padStart(2, '0')}`));
async function search(page: Page, q: string) {
  await page.getByTestId('op-input').fill(q);
  await page.getByTestId('op-submit').click();
}

test.describe('Экран и меню', () => {
  test('пункт в меню профиля (десктоп) и sheet «⋯» (моб.), вкладка не подсвечена', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [op(1, 'Forza'), op(2, 'Halo')] }, '/');
    if (isMobile(page)) {
      await page.getByRole('button', { name: 'Меню', exact: true }).click();
      const item = page.getByTestId('more-menu-other');
      await expect(item).toHaveText('Играл на другой платформе');
      await item.click();
    } else {
      await page.getByRole('button', { name: /Профиль|Меню профиля/ }).click();
      const item = page.getByTestId('profile-menu-other');
      await expect(item).toContainText('Играл на другой платформе');
      await item.click();
    }
    await expect(page).toHaveURL(/\/other-platforms$/);
    await expect(page.getByRole('heading', { name: 'Играл на другой платформе', level: 1 })).toBeVisible();
    await expect(page.locator('nav [aria-current="page"]')).toHaveCount(0);
  });

  test('карточка: обложка, название, плашка платформы, дата; нет часов/статуса/фигур; сортировка и счётчик', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [op(1, 'Forza Horizon', { platformLabel: 'Xbox One' }), op(2, 'Без платформы', { platformLabel: null })] });
    await expect(rows(page)).toHaveCount(2);
    const first = rows(page).first();
    await expect(first).toContainText('Forza Horizon');
    await expect(first.getByTestId('op-row-platform')).toHaveText('Xbox One');
    await expect(first.getByTestId('op-row-date')).toHaveText('Добавлено 3 нояб. 2026');
    await expect(rows(page).nth(1).getByTestId('op-row-platform')).toHaveText('Платформа не указана');
    await expect(first.locator('.ps-status, [data-status], .ps-glyph')).toHaveCount(0);
    await expect(first).not.toContainText(/ч\b|Играть|Купил|Не куплено/);
    await expect(page.getByTestId('op-list')).toHaveAttribute('aria-label', 'Игры, в которые играл на других платформах');
    await expect(page.getByText('В списке: 2')).toBeVisible();
    await expect(page.getByTestId('op-filter')).toHaveCount(0);
    await expect(first.getByTestId('op-remove')).toHaveAttribute('aria-label', 'Убрать из списка: Forza Horizon');
  });

  test('Бэклог не показывает записи other_platform (запрос без kind)', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [op(1, 'Forza Horizon')] }, '/backlog');
    await expect(page.getByText('Forza Horizon')).toHaveCount(0);
    await expect(page.getByTestId('bl-nb')).toHaveCount(0);
  });

  test('пустое состояние: объяснение, кнопка открывает панель', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [] });
    const empty = page.getByTestId('op-empty');
    await expect(empty).toContainText('Здесь будут игры не с PlayStation');
    await expect(empty).toContainText('Xbox, Nintendo Switch или ПК');
    await empty.getByRole('button', { name: 'Играл на другой платформе' }).click();
    await expect(page.getByTestId('op-sheet')).toBeVisible();
    await expect(page.getByTestId('op-input')).toBeFocused();
  });

  test('загрузка: скелеты 5 строк, aria-busy, кнопка добавления активна', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: tourStub }));
    await mockApi(page, lib());
    await mockOtherPlatforms(page, { items: many(3), listDelay: 800 });
    await page.goto('/other-platforms');
    const sk = page.getByTestId('op-skeleton');
    await expect(sk).toHaveAttribute('aria-busy', 'true');
    await expect(sk.locator('li')).toHaveCount(5);
    await expect(page.getByTestId('op-add')).toBeEnabled();
    await expect(rows(page)).toHaveCount(3);
    await expect(sk).toHaveCount(0);
  });

  test('ошибка загрузки: баннер, «Повторить» возвращает список', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { items: many(2), listReply: { status: 500, error: { code: 'internal', message: 'x' } } });
    const err = page.getByTestId('op-error');
    await expect(err).toHaveAttribute('role', 'alert');
    await expect(err).toContainText('Не удалось загрузить список.');
    await expect(page.getByTestId('op-add')).toBeEnabled();
    m.listReply = null;
    await page.getByTestId('op-retry').click();
    await expect(rows(page)).toHaveCount(2);
    await expect(err).toHaveCount(0);
  });

  test('офлайн: баннер «Нет соединения»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: many(2) });
    await context.setOffline(true);
    await expect(page.getByTestId('op-offline')).toContainText('Нет соединения. Список может быть неактуален.');
    await expect(page.getByTestId('op-add')).toBeEnabled();
    await context.setOffline(false);
  });

  test('фильтр при > 10 записях, «Показать ещё» по 30 без запроса, очистка', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { items: many(35) });
    await expect(rows(page)).toHaveCount(30);
    const calls = m.listCalls;
    await page.getByTestId('op-more').click();
    await expect(rows(page)).toHaveCount(35);
    await expect(page.getByTestId('op-more')).toHaveCount(0);
    expect(m.listCalls).toBe(calls);
    await page.getByTestId('op-filter').fill('игра 07');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText('Найдено: 1 из 35')).toBeVisible();
    await page.getByTestId('op-filter').fill('яяя');
    await expect(page.getByTestId('op-nores')).toContainText('Ничего не найдено по «яяя»');
    await page.getByRole('button', { name: 'Очистить фильтр' }).click();
    await expect(rows(page)).toHaveCount(30);
    expect(m.listCalls).toBe(calls);
  });
});

test.describe('Удаление', () => {
  test('без диалога: строка уходит, тост «Вернуть» 8 с, возврат теми же данными, фокус на корзину соседа', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { items: [op(1, 'Первая', { platformLabel: 'PC' }), op(2, 'Вторая'), op(3, 'Третья')] });
    await rows(page).nth(1).getByTestId('op-remove').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(rows(page)).toHaveCount(2);
    expect(m.removeCalls).toEqual([2]);
    await expect(rows(page).nth(1).getByTestId('op-remove')).toBeFocused();
    const toast = page.getByRole('status').filter({ hasText: 'Убрано из списка: «Вторая»' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Вернуть' }).click();
    await expect(rows(page)).toHaveCount(3);
    expect(m.addBodies).toHaveLength(1);
    expect(m.addBodies[0]).toMatchObject({ kind: 'other_platform', externalId: '7002', title: 'Вторая', platformLabel: 'Xbox One' });
    expect(m.addBodies[0].confirmDuplicate).toBeUndefined();
    await expect(rows(page).first()).toContainText('Вторая');
  });

  test('последняя запись: пустое состояние, фокус на кнопку', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [op(1, 'Единственная')] });
    await rows(page).first().getByTestId('op-remove').click();
    await expect(page.getByTestId('op-empty')).toBeVisible();
    await expect(page.getByTestId('op-empty-add')).toBeFocused();
  });

  test('ошибка удаления: строка возвращается, тост с «Повторить»', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { items: [op(1, 'Первая'), op(2, 'Вторая')], removeReplies: [{ status: 500, error: { code: 'internal', message: 'x' } }] });
    await rows(page).first().getByTestId('op-remove').click();
    const toast = page.getByRole('alert').filter({ hasText: 'Не удалось убрать. Повтори.' });
    await expect(toast).toBeVisible();
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).first().getByTestId('op-remove')).toBeEnabled();
    await toast.getByRole('button', { name: 'Повторить' }).click();
    await expect(rows(page)).toHaveCount(1);
    expect(m.removeCalls).toEqual([1, 1]);
  });

  test('«Вернуть» после дубля: повтор с confirmDuplicate; ошибка возврата: тост', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { items: [op(1, 'Первая'), op(2, 'Вторая')], dup: ['7001'] });
    await rows(page).first().getByTestId('op-remove').click();
    await page.getByRole('status').filter({ hasText: 'Убрано из списка: «Первая»' }).getByRole('button', { name: 'Вернуть' }).click();
    await expect(rows(page)).toHaveCount(2);
    expect(m.addBodies.map((b) => b.confirmDuplicate)).toEqual([undefined, true]);
    m.addReplies.push({ status: 500, error: { code: 'internal', message: 'x' } });
    await rows(page).first().getByTestId('op-remove').click();
    await page.getByRole('status').filter({ hasText: 'Убрано из списка' }).getByRole('button', { name: 'Вернуть' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Не удалось вернуть. Найди игру через «Играл на другой платформе».' })).toBeVisible();
  });
});

test.describe('Панель поиска', () => {
  const cands = () => [
    ocand('1', 'Halo Infinite', { platforms: ['PlayStation 5', 'Xbox One', 'PC'] }),
    ocand('2', 'Halo Reach', { platforms: ['Xbox 360'] }),
    ocand('3', 'Halo Wars', { platforms: [] }),
  ];

  test('поиск по Enter/«Найти» scope=all, платформы: не PS первыми, «Не указывать» в конце', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { candidates: cands() });
    await page.getByTestId('op-add').click();
    const dlg = page.getByRole('dialog', { name: 'Играл на другой платформе' });
    await expect(dlg).toBeVisible();
    await expect(page.getByTestId('op-input')).toBeFocused();
    await expect(page.getByTestId('op-submit')).toBeDisabled();
    await page.getByTestId('op-input').fill('ha');
    await page.waitForTimeout(400);
    expect(m.searchUrls).toEqual([]); // без автопоиска
    await page.getByTestId('op-input').fill('halo');
    await page.getByTestId('op-input').press('Enter');
    await expect(page.getByTestId('op-add-row')).toHaveCount(3);
    expect(m.searchUrls[0]).toContain('scope=all');
    const sel = page.getByTestId('op-platform').first();
    await expect(sel).toHaveAttribute('aria-label', 'Платформа: Halo Infinite');
    expect(await sel.locator('option').allTextContents()).toEqual(['Xbox One', 'PC', 'PlayStation 5', 'Не указывать']);
    await expect(sel).toHaveValue('Xbox One');
    await expect(page.getByTestId('op-platform').nth(1)).toHaveValue('Xbox 360');
    expect(await page.getByTestId('op-platform').nth(2).locator('option').allTextContents()).toEqual(['Не указана']);
    await expect(page.getByTestId('op-add-btn').first()).toHaveAttribute('aria-label', 'Добавить в список: Halo Infinite, платформа Xbox One');
  });

  test('добавление нескольких подряд, панель открыта, фокус на «Добавлено», при закрытии список и тост', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { candidates: cands() });
    await page.getByTestId('op-add').click();
    await search(page, 'halo');
    const r0 = page.getByTestId('op-add-row').nth(0);
    await r0.getByTestId('op-platform').selectOption('PC');
    await r0.getByTestId('op-add-btn').click();
    await expect(r0.getByTestId('op-add-done')).toHaveText('Добавлено · PC');
    await expect(r0.getByTestId('op-add-done')).toBeFocused();
    const r2 = page.getByTestId('op-add-row').nth(2);
    await r2.getByTestId('op-add-btn').click();
    await expect(r2.getByTestId('op-add-done')).toHaveText('Добавлено');
    expect(m.addBodies[0]).toMatchObject({ kind: 'other_platform', externalSource: 'rawg', externalId: '1', platformLabel: 'PC' });
    expect(m.addBodies[0].notPurchased).toBeUndefined();
    expect(m.addBodies[1].platformLabel).toBeNull();
    await expect(page.getByTestId('op-sheet')).toBeVisible();
    await page.getByTestId('op-close').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByRole('status').filter({ hasText: 'Добавлено в список: 2' })).toBeVisible();
    await expect(page.getByTestId('op-add')).toBeFocused();
  });

  test('одна игра: тост с названием; «Уже в списке» не даёт добавить повторно', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { items: [op(1, 'Halo Reach', { externalId: '2' })], candidates: cands() });
    await page.getByTestId('op-add').click();
    await search(page, 'halo');
    const reach = page.getByTestId('op-add-row').filter({ hasText: 'Halo Reach' });
    await expect(reach.getByTestId('op-add-done')).toHaveText('Уже в списке');
    await expect(reach.getByTestId('op-add-btn')).toHaveCount(0);
    const inf = page.getByTestId('op-add-row').filter({ hasText: 'Halo Infinite' });
    await inf.getByTestId('op-add-btn').click();
    await expect(inf.getByTestId('op-add-done')).toBeVisible();
    expect(m.addBodies).toHaveLength(1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('status').filter({ hasText: 'Добавлено в список: «Halo Infinite»' })).toBeVisible();
  });

  test('дубль с библиотекой: блок, «Всё равно добавить» шлёт confirmDuplicate, «Отмена»', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { candidates: cands(), dup: ['1'] });
    await page.getByTestId('op-add').click();
    await search(page, 'halo');
    const r0 = page.getByTestId('op-add-row').first();
    await r0.getByTestId('op-add-btn').click();
    const warn = r0.getByTestId('op-warn');
    await expect(warn).toContainText('Такая игра уже есть');
    await expect(warn).toContainText('В твоей библиотеке PSN: «Halo Infinite (PSN)»');
    await expect(warn).toContainText('отдельная запись здесь не нужна');
    await expect(warn).toBeFocused();
    await warn.getByTestId('op-warn-cancel').click();
    await expect(warn).toHaveCount(0);
    await r0.getByTestId('op-add-btn').click();
    await r0.getByTestId('op-warn-confirm').click();
    await expect(r0.getByTestId('op-add-done')).toContainText('Добавлено');
    expect(m.addBodies.map((b) => b.confirmDuplicate)).toEqual([undefined, undefined, true]);
  });

  test('manual_limit и общая ошибка: role=alert, кнопка остаётся активной', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, {
      candidates: cands(), addReplies: [{ status: 409, error: { code: 'manual_limit', message: 'x', details: { limit: 300 } } }, { status: 500, error: { code: 'internal', message: 'x' } }],
    });
    await page.getByTestId('op-add').click();
    await search(page, 'halo');
    const r0 = page.getByTestId('op-add-row').first();
    await r0.getByTestId('op-add-btn').click();
    await expect(r0.getByRole('alert')).toHaveText('Список заполнен: максимум 300 игр. Убери лишние.');
    await expect(r0.getByTestId('op-add-btn')).toBeEnabled();
    await r0.getByTestId('op-add-btn').click();
    await expect(r0.getByRole('alert')).toHaveText('Не удалось добавить. Повтори.');
  });

  test('состояния: нет результатов, лимит RAWG, каталог недоступен, ошибка поиска', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { candidates: cands() });
    await page.getByTestId('op-add').click();
    await expect(page.getByTestId('op-search-initial')).toContainText('Ищу по всем платформам.');
    await search(page, 'zzzz');
    await expect(page.getByTestId('op-search-empty')).toContainText('По запросу «zzzz» ничего не найдено.');
    m.searchReply = { status: 500, error: { code: 'internal', message: 'x' } };
    await search(page, 'halo');
    await expect(page.getByTestId('op-search-error')).toContainText('Не удалось выполнить поиск.');
    m.searchReply = { status: 503, error: { code: 'catalog_unavailable', message: 'x', details: { reason: 'no_key' } } };
    await page.getByTestId('op-search-error').getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByText('Поиск временно не работает. Список игр доступен.')).toBeVisible();
    await page.keyboard.press('Escape');
    // лимит: отдельная панель (guard живёт, пока открыта вкладка)
    m.searchReply = { status: 503, error: { code: 'catalog_unavailable', message: 'x', details: { reason: 'rate_limited', resetAt: '2099-12-01T21:00:00.000Z' } } };
    await page.getByTestId('op-add').click();
    await search(page, 'halo');
    const quota = page.getByTestId('op-quota');
    await expect(quota).toContainText('Лимит запросов к каталогу исчерпан. Новый поиск станет доступен');
    await expect(page.getByTestId('op-input')).toBeDisabled();
    await expect(page.getByTestId('op-submit')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('клавиатура: Esc закрывает и возвращает фокус на op-add; Tab не выходит из панели', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: many(1), candidates: cands() });
    await page.getByTestId('op-add').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('op-sheet')).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('op-add')).toBeFocused();
  });
});

test.describe('Вёрстка: темы и ширины', () => {
  const themes = [null, 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];
  test('7 тем: страница и панель без горизонтального скролла', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [op(1, 'Очень длинное название игры для проверки переноса строк на узком экране', { platformLabel: 'Nintendo Switch Online Classic Edition Extra Long Label' }), ...many(3).map((g) => ({ ...g, id: g.id + 10 }))], candidates: [ocand('1', 'Halo Infinite Legendary Edition Extra Long Title', { platforms: ['Xbox One', 'PlayStation 5'] })] });
    for (const t of themes) {
      await page.evaluate((v) => { if (v) document.documentElement.setAttribute('data-theme', v); else document.documentElement.removeAttribute('data-theme'); }, t);
      expect(await noHScroll(page), String(t)).toBe(true);
      const tag = await rows(page).first().getByTestId('op-row-platform').evaluate((el) => { const c = getComputedStyle(el); return { s: c.borderTopStyle, w: c.borderTopWidth }; });
      expect(tag).toEqual({ s: 'solid', w: '1px' });
    }
  });

  for (const w of [320, 360, 390, 412]) {
    test(`${w} px: нет горизонтального скролла, тап-зоны >= 44, строка результата помещается`, async ({ page, context, baseURL }) => {
      test.skip(!isMobile(page), 'мобильные ширины');
      await page.setViewportSize({ width: w, height: 760 });
      await open(page, context, baseURL!, {
        items: [op(1, 'Очень длинное название игры для проверки переноса строк на узком экране телефона', { platformLabel: 'Nintendo Switch Online Classic Edition Extra Long Label' })],
        candidates: [ocand('1', 'Halo Infinite Очень длинное название для узкой строки результата', { platforms: ['Nintendo Switch Online Classic Edition Extra Long Label', 'PlayStation 5'] })],
      });
      expect(await noHScroll(page)).toBe(true);
      const add = (await page.getByTestId('op-add').boundingBox())!;
      expect(add.height).toBeGreaterThanOrEqual(43.5);
      expect(add.width).toBeGreaterThan(w - 2 * 24);
      await expect(page.locator('.ps-op-add__short')).toBeVisible();
      await expect(page.locator('.ps-op-add__long')).toBeHidden();
      const rm = (await page.getByTestId('op-remove').boundingBox())!;
      expect(rm.width).toBeGreaterThanOrEqual(39.5);
      await page.getByTestId('op-add').click();
      await search(page, 'halo');
      const sel = (await page.getByTestId('op-platform').boundingBox())!;
      const btn = (await page.getByTestId('op-add-btn').boundingBox())!;
      expect(sel.height).toBeGreaterThanOrEqual(43.5);
      expect(btn.height).toBeGreaterThanOrEqual(43.5);
      expect(btn.x + btn.width).toBeLessThanOrEqual(w + 0.5);
      expect(sel.x + sel.width).toBeLessThanOrEqual(btn.x + 0.5);
      expect(await noHScroll(page)).toBe(true);
    });
  }

  test('reduced-motion: схлопывание без анимации', async ({ page, context, baseURL }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, context, baseURL!, { items: [op(1, 'Первая'), op(2, 'Вторая')] });
    expect(await rows(page).first().evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
    await rows(page).first().getByTestId('op-remove').click();
    await expect(rows(page)).toHaveCount(1);
  });
});
