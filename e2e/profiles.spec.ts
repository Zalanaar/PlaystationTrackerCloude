// QA Фазы 41: профили PSN. API профилей эмулируется по контракту 41.3 (профили-мок в e2e/profiles-mock.ts, БД в e2e нет);
// серверную часть доказывают src/app/api/me/profiles/routes.test.ts, src/server/profile-isolation.test.ts и onboarding-guard.test.ts на PGlite.
// Мобильный проект гоняется на 360 px.
import { test, expect, type Page } from '@playwright/test';
import { setup, ONE, TWO, THREE } from './profiles-mock';

const mobile = (info: { project: { name: string } }) => info.project.name === 'mobile';

test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize(mobile(info) ? { width: 360, height: 740 } : { width: 1280, height: 800 });
});

async function openChip(page: Page, info: { project: { name: string } }) {
  await page.locator('.ps-pswitch').click();
  return mobile(info) ? page.getByRole('dialog', { name: 'Профиль PSN' }) : page.getByRole('menu').or(page.locator('.ps-pswitch-pop'));
}

test.describe('переключатель в шапке', () => {
  test('при одном профиле нет в DOM, при двух и более есть', async ({ page, baseURL }) => {
    await setup(page, baseURL!, ONE());
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
    await expect(page.locator('.ps-pswitch')).toHaveCount(0);

    const page2 = await page.context().newPage();
    await setup(page2, baseURL!, TWO());
    await page2.goto('/');
    await expect(page2.locator('.ps-pswitch')).toHaveCount(1);
    await expect(page2.locator('.ps-pswitch')).toContainText('Artem_PS');
    await expect(page2.locator('.ps-pswitch')).toHaveAttribute('aria-label', 'Профиль PSN: Artem_PS. Сменить');
  });

  test('смена профиля: завеса, чужие данные не мелькают, фокус на h1, тост', async ({ page, baseURL }, info) => {
    const s = await setup(page, baseURL!, THREE(), { switchDelay: 700 });
    await page.goto('/');
    await expect(page.locator('main')).toContainText('Horizon Forbidden West');
    await openChip(page, info);
    await page.getByRole('menuitemradio', { name: /Second_Nick/ }).click();

    await expect(page.locator('.ps-pswitch-veil')).toBeVisible();
    await expect(page.locator('.ps-pswitch-veil')).toContainText('Открываю профиль Second_Nick');
    await expect(page.locator('html')).toHaveAttribute('data-psw', '');
    // пока завеса: контент прежнего профиля скрыт от пользователя (visibility/opacity по data-psw)
    const hidden = await page.evaluate(() => { const m = document.querySelector('main')!; const cs = getComputedStyle(m); return cs.visibility === 'hidden' || cs.opacity === '0'; });
    expect(hidden).toBe(true);

    await expect(page.locator('.ps-pswitch-veil')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('html')).not.toHaveAttribute('data-psw', '');
    await expect(page.locator('main')).toContainText('Только у второго');
    expect(await page.locator('main').innerText()).not.toContain('Horizon Forbidden West');
    await expect(page.locator('.ps-pswitch')).toContainText('Second_Nick');
    await expect(page.getByText('Профиль PSN: Second_Nick').first()).toBeVisible();
    expect(s.calls.filter((c) => c.startsWith('POST active'))).toEqual(['POST active 2']);
    // повторный выбор того же профиля: запроса нет
    await openChip(page, info);
    await page.getByRole('menuitemradio', { name: /Second_Nick/ }).click();
    expect(s.calls.filter((c) => c.startsWith('POST active'))).toHaveLength(1);
  });

  // QA-41-2: focusPageHeading() вызывается, пока html[data-psw] ещё стоит (main { visibility: hidden }), focus() молча не срабатывает.
  test('фокус на h1 после смены профиля (QA-41-2)', async ({ page, baseURL }, info) => {
    await setup(page, baseURL!, TWO());
    await page.goto('/');
    await expect(page.locator('main')).toContainText('Horizon Forbidden West');
    await openChip(page, info);
    await page.getByRole('menuitemradio', { name: /Second_Nick/ }).click();
    await expect(page.locator('main')).toContainText('Только у второго');
    await expect(page.locator('main h1')).toBeFocused();
  });

  test('ошибка смены: тост «Повторить», данные не меняются; 404 обновляет список', async ({ page, baseURL }, info) => {
    const s = await setup(page, baseURL!, TWO(), { switchFail: { status: 500, code: 'internal' } });
    await page.goto('/');
    await expect(page.locator('main')).toContainText('Horizon Forbidden West');
    await openChip(page, info);
    await page.getByRole('menuitemradio', { name: /Second_Nick/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Не удалось сменить профиль' })).toBeVisible();
    await expect(page.locator('.ps-pswitch-veil')).toHaveCount(0);
    await expect(page.locator('main')).toContainText('Horizon Forbidden West');
    s.switchFail = null;
    // «Повторить» именно в тосте смены профиля (у блока «Игры с других платформ» своя кнопка повтора загрузки)
    await page.locator('.ps-toast').getByRole('button', { name: 'Повторить' }).click();
    await expect(page.locator('main')).toContainText('Только у второго');
  });

  test('localStorage: настройки вида лежат под ключом с id активного профиля, у второго профиля не наследуются', async ({ page, baseURL }, info) => {
    await setup(page, baseURL!, TWO());
    await page.goto('/');
    await expect(page.locator('main')).toContainText('Horizon Forbidden West');
    await page.evaluate(() => localStorage.setItem('ps-view:1', 'list'));
    await openChip(page, info);
    await page.getByRole('menuitemradio', { name: /Second_Nick/ }).click();
    await expect(page.locator('main')).toContainText('Только у второго');
    const keys = await page.evaluate(() => ({ k: Object.keys(localStorage), v1: localStorage.getItem('ps-view:1'), v2: localStorage.getItem('ps-view:2') }));
    expect(keys.v1).toBe('list');
    expect(keys.v2).toBeNull();
    // сохранённый вид второго профиля не берётся из первого; общий ключ не создаётся
    expect(keys.k).not.toContain('ps-view');
  });

  test('клавиатура на десктопе: ArrowDown открывает меню, Escape закрывает и возвращает фокус', async ({ page, baseURL }, info) => {
    test.skip(mobile(info), 'меню-поповер только на десктопе');
    await setup(page, baseURL!, TWO());
    await page.goto('/');
    await page.locator('.ps-pswitch').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitemradio', { name: /Artem_PS/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitemradio', { name: /Artem_PS/ })).toHaveCount(0);
    await expect(page.locator('.ps-pswitch')).toBeFocused();
  });
});

test.describe('/profiles', () => {
  test('список, счётчик, ссылка из переключателя; один профиль: пустое состояние', async ({ page, baseURL }) => {
    await setup(page, baseURL!, ONE());
    await page.goto('/profiles');
    await expect(page.getByRole('heading', { level: 1, name: 'Профили PSN' })).toBeVisible();
    await expect(page.locator('.ps-pempty')).toContainText('Один профиль PSN');
    await expect(page.getByText('Основной профиль нельзя отвязать')).toBeVisible();
    await expect(page.getByRole('button', { name: /Отвязать профиль/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  test('добавление: невалидный ник блокирует кнопку, формат-ошибка под полем', async ({ page, baseURL }) => {
    const s = await setup(page, baseURL!, TWO());
    await page.goto('/profiles');
    await page.getByRole('button', { name: 'Добавить PSN-профиль' }).click();
    const dlg = page.getByRole('dialog', { name: 'Добавить PSN-профиль' });
    await expect(dlg.getByLabel('Ник в PSN (Online ID)')).toBeFocused();
    await dlg.getByLabel('Ник в PSN (Online ID)').fill('1ab');
    await dlg.getByLabel('Ник в PSN (Online ID)').blur();
    await expect(dlg.getByRole('alert')).toContainText('Ник: 3-16 символов');
    await expect(dlg.getByRole('button', { name: 'Добавить', exact: true })).toBeDisabled();
    expect(s.calls.filter((c) => c.startsWith('POST'))).toEqual([]);
  });

  const ERRORS: Array<[string, { status: number; code: string; details?: unknown }, RegExp]> = [
    ['invalid_request', { status: 400, code: 'invalid_request' }, /Проверь ник: так он записать нельзя/],
    ['profile_limit', { status: 409, code: 'profile_limit', details: { limit: 3 } }, /Достигнут лимит: 3 профиля PSN/],
    ['user_limit', { status: 409, code: 'user_limit' }, /общий лимит пользователей/],
    ['psn_id_taken', { status: 409, code: 'psn_id_taken' }, /уже подключён/],
    ['psn_not_found', { status: 422, code: 'psn_not_found' }, /не найден в PSN/],
    ['psn_private', { status: 422, code: 'psn_private' }, /закрыт/],
    ['rate_limited', { status: 429, code: 'rate_limited', details: { retryAfterSec: 25 } }, /Слишком часто\. Повтори через 25 с/],
    ['psn_unavailable', { status: 503, code: 'psn_unavailable' }, /PSN сейчас недоступен/],
    ['unknown 500', { status: 500, code: 'internal' }, /Не удалось добавить профиль/],
  ];
  for (const [name, fail, re] of ERRORS) {
    test(`добавление: ошибка ${name}`, async ({ page, baseURL }) => {
      const s = await setup(page, baseURL!, TWO(), { addFail: fail });
      await page.goto('/profiles');
      await page.getByRole('button', { name: 'Добавить PSN-профиль' }).click();
      const dlg = page.getByRole('dialog', { name: 'Добавить PSN-профиль' });
      await dlg.getByLabel('Ник в PSN (Online ID)').fill('Valid_Nick');
      await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
      await expect(dlg.getByRole('alert').filter({ hasText: re })).toBeVisible();
      expect(s.profiles).toHaveLength(2); // состояние не изменилось
      await expect(dlg).toBeVisible();
      if (name === 'rate_limited') await expect(dlg.getByRole('button', { name: /^Добавить \(\d+\)$/ })).toBeDisabled();
      if (name === 'psn_unavailable') await expect(dlg.getByRole('button', { name: 'Повторить' })).toBeVisible();
    });
  }

  test('добавление: сбой сети', async ({ page, baseURL }) => {
    await setup(page, baseURL!, TWO(), { addFail: 'abort' });
    await page.goto('/profiles');
    await page.getByRole('button', { name: 'Добавить PSN-профиль' }).click();
    const dlg = page.getByRole('dialog', { name: 'Добавить PSN-профиль' });
    await dlg.getByLabel('Ник в PSN (Online ID)').fill('Valid_Nick');
    await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(dlg.getByRole('alert').filter({ hasText: 'Нет связи' })).toBeVisible();
  });

  test('добавление с «Сразу открыть»: активируется, завеса, шапка с новым ником, список 3 из 3', async ({ page, baseURL }) => {
    const s = await setup(page, baseURL!, TWO());
    await page.goto('/profiles');
    await page.getByRole('button', { name: 'Добавить PSN-профиль' }).click();
    const dlg = page.getByRole('dialog', { name: 'Добавить PSN-профиль' });
    await dlg.getByLabel('Ник в PSN (Online ID)').fill('New_Nick');
    await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(page.locator('.ps-pswitch')).toContainText('New_Nick', { timeout: 10_000 });
    expect(s.bodies[0].body).toEqual({ onlineId: 'New_Nick', activate: true });
    await expect(page.getByLabel('Профилей: 3 из 3')).toBeVisible();
  });

  test('добавление без активации: тост, активный не меняется', async ({ page, baseURL }) => {
    const s = await setup(page, baseURL!, TWO());
    await page.goto('/profiles');
    await page.getByRole('button', { name: 'Добавить PSN-профиль' }).click();
    const dlg = page.getByRole('dialog', { name: 'Добавить PSN-профиль' });
    await dlg.getByLabel('Ник в PSN (Online ID)').fill('Quiet_Nick');
    await dlg.getByText('Сразу открыть этот профиль').click();
    await dlg.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(page.getByText('Профиль Quiet_Nick добавлен')).toBeVisible();
    expect(s.bodies[0].body).toEqual({ onlineId: 'Quiet_Nick', activate: false });
    expect(s.active).toBe(1);
    await expect(page.locator('.ps-pswitch')).toContainText('Artem_PS');
  });

  test('лимит 3 из 3: «Добавить» недоступна, причина текстом', async ({ page, baseURL }) => {
    await setup(page, baseURL!, THREE());
    await page.goto('/profiles');
    const btn = page.getByRole('button', { name: 'Добавить PSN-профиль' });
    await expect(btn).toBeDisabled();
    await expect(page.getByText('Достигнут лимит: 3 из 3')).toBeVisible();
    await expect(page.getByLabel('Профилей: 3 из 3')).toBeVisible();
  });

  test('отвязка: кнопка включается только после ввода ника, архив, «Вернуть»', async ({ page, baseURL }) => {
    const s = await setup(page, baseURL!, THREE());
    await page.goto('/profiles');
    await page.getByRole('button', { name: 'Отвязать профиль Third_Nick' }).click();
    const dlg = page.getByRole('dialog', { name: 'Отвязать профиль Third_Nick?' });
    const go = dlg.getByRole('button', { name: 'Отвязать', exact: true });
    await expect(go).toBeDisabled();
    await dlg.getByRole('textbox').fill('Second_Nick');
    await expect(go).toBeDisabled();
    await dlg.getByRole('textbox').fill('  third_nick ');
    await expect(go).toBeEnabled();
    await go.click();
    await expect(page.getByText('Профиль Third_Nick отвязан. Вернуть можно в течение 30 дней.')).toBeVisible();
    expect(s.bodies.at(-1)).toMatchObject({ body: { confirmOnlineId: 'third_nick' } });
    const arch = page.getByRole('region', { name: 'Архив' });
    await expect(arch).toContainText('Third_Nick');
    await expect(arch).toContainText('удалится через 30 дней');
    await expect(page.getByLabel('Профилей: 2 из 3')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Добавить PSN-профиль' })).toBeEnabled();

    await arch.getByRole('button', { name: 'Вернуть профиль Third_Nick' }).click();
    await expect(page.getByText('Профиль Third_Nick возвращён')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Архив' })).toHaveCount(0);
    await expect(page.getByLabel('Профилей: 3 из 3')).toBeVisible();
    expect(s.bodies.at(-1)?.body).toEqual({ onlineId: 'Third_Nick', activate: false });
  });

  test('«Удалить сразу» из архива с подтверждением ником', async ({ page, baseURL }) => {
    const s = await setup(page, baseURL!, TWO(), { archived: [{ id: 5, onlineId: 'Old_Nick', archivedAt: '2026-10-20T10:00:00.000Z', purgeAt: new Date(Date.now() + 2.5 * 86_400_000).toISOString() }] });
    await page.goto('/profiles');
    const arch = page.getByRole('region', { name: 'Архив' });
    await expect(arch).toContainText('удалится через 3 дня');
    await arch.getByRole('button', { name: 'Удалить профиль Old_Nick насовсем' }).click();
    const dlg = page.getByRole('dialog', { name: 'Удалить профиль Old_Nick насовсем?' });
    await expect(dlg.getByRole('button', { name: 'Удалить насовсем' })).toBeDisabled();
    await dlg.getByRole('textbox').fill('Old_Nick');
    await dlg.getByRole('button', { name: 'Удалить насовсем' }).click();
    await expect(page.getByText('Профиль Old_Nick удалён')).toBeVisible();
    expect(s.bodies.at(-1)?.body).toEqual({ confirmOnlineId: 'Old_Nick', purge: true });
    await expect(page.getByRole('region', { name: 'Архив' })).toHaveCount(0);
  });

  test('отвязка: ошибки (confirm_mismatch, sync_in_progress, not_found)', async ({ page, baseURL }) => {
    const s = await setup(page, baseURL!, THREE(), { delFail: { status: 422, code: 'confirm_mismatch' } });
    await page.goto('/profiles');
    await page.getByRole('button', { name: 'Отвязать профиль Third_Nick' }).click();
    const dlg = page.getByRole('dialog', { name: 'Отвязать профиль Third_Nick?' });
    await dlg.getByRole('textbox').fill('Third_Nick');
    await dlg.getByRole('button', { name: 'Отвязать', exact: true }).click();
    await expect(dlg.getByRole('alert').filter({ hasText: 'Ник не совпал' })).toBeVisible();
    s.delFail = { status: 409, code: 'sync_in_progress' };
    await dlg.getByRole('button', { name: 'Отвязать', exact: true }).click();
    await expect(dlg.getByRole('alert').filter({ hasText: 'Сейчас идёт синк этого профиля' })).toBeVisible();
    s.delFail = { status: 404, code: 'not_found' };
    await dlg.getByRole('button', { name: 'Отвязать', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'уже отвязан или удалён' })).toBeVisible();
    await expect(dlg).toHaveCount(0);
  });

  test('отвязка активного профиля: откроется основной, данные основного, завеса', async ({ page, baseURL }) => {
    const s = await setup(page, baseURL!, TWO(), { active: 2 });
    await page.goto('/');
    await expect(page.locator('main')).toContainText('Только у второго');
    await page.goto('/profiles');
    await expect(page.locator('li[data-pid="2"]')).toHaveAttribute('aria-current', 'true');
    await page.getByRole('button', { name: 'Отвязать профиль Second_Nick' }).click();
    const dlg = page.getByRole('dialog', { name: 'Отвязать профиль Second_Nick?' });
    await expect(dlg).toContainText('Сейчас он открыт. После отвязки откроется основной профиль.');
    await dlg.getByRole('textbox').fill('Second_Nick');
    await dlg.getByRole('button', { name: 'Отвязать', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Архив' })).toContainText('Second_Nick');
    await expect(page.locator('li[data-pid="1"]')).toHaveAttribute('aria-current', 'true');
    expect(s.active).toBe(1);
    // после отвязки одного из двух остаётся один профиль: переключателя нет, коллекция основного
    await expect(page.locator('.ps-pswitch')).toHaveCount(0);
    await page.goto('/');
    await expect(page.locator('main')).toContainText('Horizon Forbidden West');
    expect(await page.locator('main').innerText()).not.toContain('Только у второго');
  });

  test('сессия профиля умерла (401) при переключении: переход на вход', async ({ page, baseURL }, info) => {
    await setup(page, baseURL!, TWO());
    await page.goto('/');
    await page.route(/\/api\/me\/profiles\/active$/, (r) => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'unauthorized', message: 'x' } }) }));
    await openChip(page, info);
    const toLogin = page.waitForRequest((r) => new URL(r.url()).pathname === '/login');
    await page.getByRole('menuitemradio', { name: /Second_Nick/ }).click();
    expect((await toLogin).url()).toContain('next=');
    await expect(page.locator('.ps-pswitch-veil')).toHaveCount(0);
  });
});
