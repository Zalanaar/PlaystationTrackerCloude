// Фаза 44 + пакет 5: «Игры с других платформ» — блок в самом низу Коллекции (design-system §19c). API эмулируется (other-platform-mock.ts).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { mockManual } from './manual-mock';
import { mockOtherPlatforms, ocand, op, type OPMock } from './other-platform-mock';
import { isMobile } from './backlog-ui';
import { signedSession } from './session';

const lib = (): G[] => [{ id: 1, title: 'Альфа Экшен', lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null }];
const tourStub = JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } });
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function open(page: Page, context: BrowserContext, baseURL: string, o: Partial<OPMock> = {}, url = '/'): Promise<OPMock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: tourStub }));
  await page.addInitScript(() => localStorage.setItem('ps-wn-seen:1', '14'));
  await mockApi(page, lib());
  await mockManual(page); // Бэклог: пустые записи ps_backlog
  const m = await mockOtherPlatforms(page, o);
  await page.goto(url);
  if (url === '/') await page.getByTestId('op-block').waitFor();
  else await page.locator('main').waitFor();
  return m;
}
const rows = (page: Page) => page.getByTestId('op-row');
const many = (n: number) => Array.from({ length: n }, (_, i) => op(i + 1, `Игра ${String(i + 1).padStart(2, '0')}`));
async function search(page: Page, q: string) {
  await page.getByTestId('op-input').fill(q);
  await page.getByTestId('op-submit').click();
}
const dialog = (page: Page) => page.getByTestId('op-dialog');
async function openRow(page: Page, title: string) {
  await rows(page).filter({ hasText: title }).getByTestId('op-open').click();
  await expect(dialog(page)).toBeVisible();
}

test.describe('Блок в Коллекции', () => {
  test('пунктов меню больше нет; старый адрес ведёт в Коллекцию; блок последний в хронике', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [op(1, 'Forza'), op(2, 'Halo')] });
    if (isMobile(page)) {
      await page.getByRole('button', { name: 'Меню', exact: true }).click();
      await expect(page.getByTestId('more-menu-trophies')).toBeVisible();
      await expect(page.getByTestId('more-menu-other')).toHaveCount(0);
      await page.keyboard.press('Escape');
    } else {
      await page.getByRole('button', { name: /Профиль|Меню профиля/ }).click();
      await expect(page.getByTestId('menu-trophies')).toBeVisible();
      await expect(page.getByTestId('profile-menu-other')).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    await expect(page.getByText('Играл на другой платформе')).toHaveCount(0);
    const last = await page.locator('.ps-blocks > *').last().getAttribute('data-testid');
    expect(last).toBe('op-block');
    await page.goto('/other-platforms');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('op-block')).toBeVisible();
  });

  test('строка: обложка, название, платформа, статус, оценка; группы по году и «Не распределено»; сводка', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, {
      items: [
        op(1, 'Forza Horizon', { platformLabel: 'Xbox One', status: 'completed', statusChangedAt: '2025-06-01T10:00:00.000Z', rating: 9 }),
        op(2, 'Без платформы', { platformLabel: null }),
        op(3, 'Zelda', { platformLabel: 'Nintendo Switch', status: 'dropped', statusChangedAt: '2026-02-01T10:00:00.000Z', rating: 6 }),
        op(4, 'Hades', { platformLabel: 'PC', status: 'playing', statusChangedAt: '2026-10-01T10:00:00.000Z' }),
      ],
    });
    const block = page.getByTestId('op-block');
    await expect(block.getByRole('heading', { name: 'Игры с других платформ', level: 2 })).toBeVisible();
    await expect(page.getByTestId('op-group').locator('h3')).toHaveText(['2026 1', '2025 1', 'Не распределено 2']);
    const forza = rows(page).filter({ hasText: 'Forza Horizon' });
    await expect(forza.getByTestId('op-row-platform')).toHaveText('Xbox One');
    await expect(forza.getByTestId('op-row-status')).toHaveText('Пройдено');
    await expect(forza.getByTestId('op-row-rating')).toHaveText('9/10');
    await expect(rows(page).filter({ hasText: 'Без платформы' }).getByTestId('op-row-platform')).toHaveText('Платформа не указана');
    await expect(forza).not.toContainText(/ч\b|Купил|Не куплено/);
    const st = page.getByTestId('op-stats');
    await expect(st).toContainText('4 игры');
    await expect(st).toContainText('Switch 1 · Xbox 1 · PC 1 · Не указана 1');
    await expect(st).toContainText('7,5/10');
    await expect(st.locator('[data-status="completed"]')).toHaveAttribute('aria-label', 'Пройдено: 1');
  });

  test('блок только в чистой хронике: поиск и фильтр статуса его прячут', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [op(1, 'Forza')] });
    await page.goto('/?status=backlog');
    await page.locator('main').waitFor();
    await expect(page.getByText('Альфа Экшен').first()).toBeVisible();
    await expect(page.getByTestId('op-block')).toHaveCount(0);
  });

  test('Бэклог не показывает записи other_platform (запрос без kind)', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [op(1, 'Forza Horizon')] }, '/backlog');
    await expect(page.getByText('Forza Horizon')).toHaveCount(0);
    await expect(page.getByTestId('bl-nb')).toHaveCount(0);
  });

  test('пусто: пояснение и «+ Другая платформа» открывает панель', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [] });
    await expect(page.getByTestId('op-empty')).toContainText('Switch, Xbox или ПК');
    await expect(page.getByTestId('op-stats')).toHaveCount(0);
    await page.getByTestId('op-add').click();
    await expect(page.getByTestId('op-sheet')).toBeVisible();
    await expect(page.getByTestId('op-input')).toBeFocused();
  });

  test('ошибка загрузки: сообщение, «Повторить» возвращает список', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { items: many(2), listReply: { status: 500, error: { code: 'internal', message: 'x' } } });
    const err = page.getByTestId('op-error');
    await expect(err).toContainText('Не удалось загрузить игры с других платформ.');
    await expect(page.getByTestId('op-add')).toBeEnabled();
    m.listReply = null;
    await err.getByRole('button', { name: 'Повторить' }).click();
    await expect(rows(page)).toHaveCount(2);
    await expect(err).toHaveCount(0);
  });
});

test.describe('Окно записи', () => {
  test('как окно игры: часы и трофеи «нет», платформа Switch/Xbox/PC/нет, статус △○□✕/нет', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { items: [op(1, 'Halo', { platformLabel: 'Xbox Series S/X' })] });
    await openRow(page, 'Halo');
    const d = dialog(page);
    await expect(page.getByRole('dialog', { name: 'Halo' })).toBeVisible();
    await expect(d.getByRole('listitem', { name: 'Часы: нет' })).toBeVisible();
    await expect(d.getByRole('listitem', { name: 'Трофеи: нет' })).toBeVisible();
    const plat = d.getByTestId('op-platform-chips').getByRole('button');
    await expect(plat).toHaveText(['Switch', 'Xbox', 'PC', 'нет']);
    await expect(d.locator('[data-platform="Xbox"]')).toHaveAttribute('aria-pressed', 'true');
    await d.locator('[data-platform="Switch"]').click();
    await expect(d.locator('[data-platform="Switch"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(d.getByTestId('op-dialog-sub')).toContainText('Switch');
    const sts = d.getByTestId('op-status-chips').getByRole('button');
    await expect(sts).toHaveText(['Играю', 'Пройдено', 'Бэклог', 'Брошено', 'нет']);
    await expect(d.locator('[data-status="none"]')).toHaveAttribute('aria-pressed', 'true');
    await d.locator('button[data-status="completed"]').click();
    await expect(d.locator('button[data-status="completed"]')).toHaveAttribute('aria-pressed', 'true');
    expect(m.patchBodies).toEqual([{ platformLabel: 'Switch' }, { status: 'completed' }]);
    // в Коллекции у строки появились статус и год
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(rows(page).first().getByTestId('op-row-status')).toHaveText('Пройдено');
    await expect(page.getByTestId('op-group').first().locator('h3')).toHaveText('2026 1');
    await expect(rows(page).first().getByTestId('op-open')).toBeFocused();
  });

  test('оценка 0–10 и заметка сохраняются PATCH; ошибка статуса: сообщение', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { items: [op(1, 'Halo')] });
    await openRow(page, 'Halo');
    const d = dialog(page);
    await d.locator('.ps-rate__opt').filter({ hasText: /^8$/ }).click();
    await expect(d.getByTestId('review-value')).toHaveText('8/10');
    await expect.poll(() => m.patchBodies.length).toBe(1);
    expect(m.patchBodies[0]).toEqual({ rating: 8, note: null });
    await d.getByRole('textbox', { name: 'Заметка' }).fill('Отличная');
    await d.getByRole('textbox', { name: 'Заметка' }).blur();
    await expect.poll(() => m.patchBodies.length).toBe(2);
    expect(m.patchBodies[1]).toEqual({ rating: 8, note: 'Отличная' });
    await expect(d.getByText('Сохранено')).toBeVisible();
    m.patchReplies.push({ status: 503, error: { code: 'db_unavailable', message: 'x' } });
    await d.locator('button[data-status="playing"]').click();
    await expect(d.getByTestId('op-dialog-err')).toHaveText('Не сохранено. Повтори.');
    await expect(d.locator('button[data-status="playing"]')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Escape');
    await expect(rows(page).first().getByTestId('op-row-rating')).toHaveText('8/10');
  });

  test('удаление из окна: строка уходит, тост «Вернуть» возвращает запись теми же данными, со статусом, оценкой и заметкой', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, {
      items: [op(1, 'Первая', { platformLabel: 'PC' }), op(2, 'Вторая', { status: 'completed', statusChangedAt: '2025-05-01T10:00:00.000Z', rating: 7, note: 'Хорошая' })],
    });
    await openRow(page, 'Вторая');
    await dialog(page).getByTestId('op-dialog-remove').click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(1);
    expect(m.removeCalls).toEqual([2]);
    const toast = page.getByRole('status').filter({ hasText: 'Убрано из списка: «Вторая»' });
    await toast.getByRole('button', { name: 'Вернуть' }).click();
    await expect(rows(page)).toHaveCount(2);
    expect(m.addBodies[0]).toMatchObject({ kind: 'other_platform', externalId: '7002', title: 'Вторая', platformLabel: 'Xbox One' });
    await expect.poll(() => m.patchBodies.length).toBe(1);
    expect(m.patchBodies[0]).toEqual({ status: 'completed', statusChangedAt: '2025-05-01T10:00:00.000Z', rating: 7, note: 'Хорошая' });
    const back = rows(page).filter({ hasText: 'Вторая' });
    await expect(back.getByTestId('op-row-rating')).toHaveText('7/10');
    // вернулась в свой год (2025), а не в «Не распределено»
    await expect(page.getByTestId('op-block').locator('[data-year="2025"]').filter({ hasText: 'Вторая' })).toHaveCount(1);
  });

  test('ошибка удаления: окно остаётся, тост об ошибке', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [op(1, 'Первая')], removeReplies: [{ status: 500, error: { code: 'internal', message: 'x' } }] });
    await openRow(page, 'Первая');
    await dialog(page).getByTestId('op-dialog-remove').click();
    await expect(page.getByRole('alert').filter({ hasText: 'Не удалось удалить. Повтори.' })).toBeVisible();
    await expect(dialog(page)).toBeVisible();
  });
});

test.describe('Панель поиска', () => {
  const cands = () => [
    ocand('1', 'Halo Infinite', { platforms: ['PlayStation 5', 'Xbox One', 'PC'] }),
    ocand('2', 'Halo Reach', { platforms: ['Xbox 360'] }),
    ocand('3', 'Halo Wars', { platforms: [] }),
  ];

  test('поиск по Enter/«Найти» scope=all, платформа — чипы Switch / Xbox / PC / «нет», по умолчанию узнанная из RAWG', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { candidates: cands() });
    await page.getByTestId('op-add').click();
    const dlg = page.getByTestId('op-sheet');
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
    const chips = page.getByTestId('op-platform').first();
    await expect(chips).toHaveAttribute('aria-label', 'Платформа: Halo Infinite');
    await expect(chips.getByRole('button')).toHaveText(['Switch', 'Xbox', 'PC', 'нет']);
    const pressed = (i: number) => page.getByTestId('op-platform').nth(i).locator('[aria-pressed="true"]');
    await expect(pressed(0)).toHaveText('Xbox');   // Xbox One, PC, PlayStation 5 → первая узнанная
    await expect(pressed(1)).toHaveText('Xbox');   // Xbox 360
    await expect(pressed(2)).toHaveText('нет');    // RAWG без платформ
    await expect(page.getByTestId('op-add-btn').first()).toHaveAttribute('aria-label', 'Добавить в список: Halo Infinite, платформа Xbox');
  });

  test('добавление нескольких подряд, панель открыта, фокус на «Добавлено», при закрытии список и тост', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { candidates: cands() });
    await page.getByTestId('op-add').click();
    await search(page, 'halo');
    const r0 = page.getByTestId('op-add-row').nth(0);
    await r0.getByTestId('op-platform').getByRole('button', { name: 'PC' }).click();
    await expect(r0.getByTestId('op-platform').getByRole('button', { name: 'PC' })).toHaveAttribute('aria-pressed', 'true');
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
    // фокус переходит на «Добавлено» эффектом после отрисовки; Escape обрабатывает лист (onKeyDown), поэтому ждём фокус,
    // а не только видимость: под нагрузкой (CI) Escape уходил в body между удалением кнопки и переносом фокуса
    await expect(inf.getByTestId('op-add-done')).toBeFocused();
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
    // под нагрузкой фокус переходит в панель после кадра появления: Tab раньше уходит со страницы
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
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
  const long = () => [
    op(1, 'Очень длинное название игры для проверки переноса строк на узком экране телефона', { platformLabel: 'Nintendo Switch Online Classic Edition Extra Long Label', status: 'completed', statusChangedAt: '2026-01-01T10:00:00.000Z', rating: 10 }),
    ...many(3).map((g) => ({ ...g, id: g.id + 10 })),
  ];
  test('7 тем: блок и окно без горизонтального скролла', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: long() });
    for (const t of themes) {
      await page.evaluate((v) => { if (v) document.documentElement.setAttribute('data-theme', v); else document.documentElement.removeAttribute('data-theme'); }, t);
      expect(await noHScroll(page), String(t)).toBe(true);
      const tag = await rows(page).first().getByTestId('op-row-platform').evaluate((el) => { const c = getComputedStyle(el); return { s: c.borderTopStyle, w: c.borderTopWidth }; });
      expect(tag).toEqual({ s: 'solid', w: '1px' });
    }
    await rows(page).first().getByTestId('op-open').click();
    await expect(dialog(page)).toBeVisible();
    const over = await dialog(page).evaluate((el) => { const s = el.closest('.ps-gd__scroll') as HTMLElement; return s.scrollWidth - s.clientWidth; });
    expect(over).toBeLessThanOrEqual(0);
  });

  for (const w of [320, 360, 390, 412]) {
    test(`${w} px: нет горизонтального скролла, тап-зоны >= 44 в блоке и окне`, async ({ page, context, baseURL }) => {
      test.skip(!isMobile(page), 'мобильные ширины');
      await page.setViewportSize({ width: w, height: 760 });
      await open(page, context, baseURL!, { items: long() });
      expect(await noHScroll(page)).toBe(true);
      const add = (await page.getByTestId('op-add').boundingBox())!;
      expect(add.height).toBeGreaterThanOrEqual(43.5);
      const row = (await rows(page).first().getByTestId('op-open').boundingBox())!;
      expect(row.height).toBeGreaterThanOrEqual(43.5);
      expect(row.x + row.width).toBeLessThanOrEqual(w + 0.5);
      await rows(page).first().getByTestId('op-open').click();
      await expect(dialog(page)).toBeVisible();
      for (const b of await dialog(page).locator('.ps-opd__chip').all()) {
        const bb = (await b.boundingBox())!;
        expect(bb.height).toBeGreaterThanOrEqual(43.5);
        expect(bb.x + bb.width).toBeLessThanOrEqual(w + 0.5);
      }
      const rm = (await dialog(page).getByTestId('op-dialog-remove').boundingBox())!;
      expect(rm.height).toBeGreaterThanOrEqual(43.5);
      await page.keyboard.press('Escape');
      await page.getByTestId('op-add').click();
      await search(page, 'zzz');
      expect(await noHScroll(page)).toBe(true);
    });
  }
});

// t160u: добавить игру с другой платформы можно без блока внизу — «+» в шапке (телефон) и пункт меню «…» / «Фильтры»
test.describe('Добавление из шапки и меню', () => {
  const cands = () => [ocand('1', 'Halo Infinite', { platforms: ['Xbox One'] })];
  async function openFromMenu(page: Page) {
    if (isMobile(page)) {
      await page.getByRole('button', { name: /^Фильтры и сортировка/ }).click();
      await page.getByRole('dialog', { name: 'Фильтры' }).getByRole('menuitem', { name: /Добавить игру с другой платформы/ }).click();
    } else {
      await page.getByRole('button', { name: 'Ещё: действия с коллекцией' }).click();
      await page.getByRole('menuitem', { name: /Добавить игру с другой платформы/ }).click();
    }
    await expect(page.getByTestId('op-sheet')).toBeVisible();
  }
  async function addHalo(page: Page) {
    await search(page, 'halo');
    await page.getByTestId('op-add-row').first().getByTestId('op-add-btn').click();
    await expect(page.getByTestId('op-add-row').first().getByTestId('op-add-done')).toContainText('Добавлено');
    await page.getByTestId('op-close').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  test('«+» шапки на Коллекции открывает панель; на Бэклоге «+» прежний (магазин PS); на десктопе кнопки нет', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { items: [op(1, 'Forza')], candidates: cands() });
    const plus = page.getByRole('button', { name: 'Добавить игру с другой платформы', exact: true });
    if (!isMobile(page)) {
      await expect(plus).toBeHidden();
      return;
    }
    await expect(plus).toBeVisible();
    const box = (await plus.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId('hdr-add')).toHaveCount(0);
    await plus.click();
    await expect(page.getByTestId('op-sheet')).toBeVisible();
    await expect(page.getByTestId('op-input')).toBeFocused();
    await addHalo(page);
    // блок на экране: запись появляется в нём без перезагрузки, тост без действия
    await expect(rows(page)).toHaveCount(2);
    const toast = page.locator('.ps-toast').filter({ hasText: 'Добавлено в список: «Halo Infinite»' });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Показать' })).toHaveCount(0);
    await expect(plus).toBeFocused();
    await page.goto('/backlog');
    await expect(page.getByTestId('hdr-add')).toHaveAttribute('aria-label', 'Добавить из магазина PS');
    await expect(page.getByTestId('hdr-add-other')).toHaveCount(0);
  });

  test('меню: панель работает и при скрытом блоке; «Показать» сбрасывает фильтры и прокручивает к блоку', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { items: [op(1, 'Forza')], candidates: cands() }, '/?status=backlog&platinum=1');
    await expect(page.getByTestId('op-block')).toHaveCount(0);
    await openFromMenu(page);
    await addHalo(page);
    expect(m.addBodies[0]).toMatchObject({ kind: 'other_platform', externalId: '1', platformLabel: 'Xbox' });
    const toast = page.locator('.ps-toast').filter({ hasText: 'скрыт фильтрами' });
    await expect(toast).toContainText('Добавлено в список: «Halo Infinite»');
    await toast.getByRole('button', { name: 'Показать' }).click();
    await expect(page).toHaveURL((u) => !u.search.includes('status=') && !u.search.includes('platinum'));
    const block = page.getByTestId('op-block');
    await expect(rows(page).filter({ hasText: 'Halo Infinite' })).toBeVisible();
    await expect(block).toBeInViewport();
  });
});
