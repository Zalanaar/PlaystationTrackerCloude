// Фаза 20.2: /login (Google, тексты ошибок) и экран «Доступ». API эмулируется (контракт 22.4, 22.5).
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

type U = {
  id: number; email: string; displayName: string | null; role: 'owner' | 'member'; status: 'invited' | 'active' | 'blocked';
  psnOnlineId: string | null; psnAccessStatus: string; lastLoginAt: string | null; createdAt: string; gamesCount: number; lastSyncAt: string | null;
};
const user = (o: Partial<U> & { id: number; email: string }): U => ({
  displayName: null, role: 'member', status: 'active', psnOnlineId: null, psnAccessStatus: 'unchecked', lastLoginAt: null,
  createdAt: '2026-10-29T10:00:00.000Z', gamesCount: 0, lastSyncAt: null, ...o,
});
const owner = user({ id: 1, email: 'owner@example.com', role: 'owner', psnOnlineId: 'artem', psnAccessStatus: 'ok', lastLoginAt: '2026-10-29T10:00:00.000Z', gamesCount: 214 });

type Mock = { users: U[]; role: 'owner' | 'member'; listStatus: number; post: { status: number; code: string } | null; patches: unknown[]; deletes: unknown[] };

async function open(page: Page, context: BrowserContext, baseURL: string, over: Partial<Mock> = {}): Promise<Mock> {
  const m: Mock = { users: [owner, user({ id: 2, email: 'bob@example.com', status: 'blocked' }), user({ id: 3, email: 'eve@example.com', status: 'invited' })], role: 'owner', listStatus: 200, post: null, patches: [], deletes: [], ...over };
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, []);
  const ok = (r: Route, data: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  const fail = (r: Route, status: number, code: string) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code, message: 'x' } }) });
  await page.route('**/api/auth/me', (r) => ok(r, { id: m.role === 'owner' ? 1 : 2, email: 'x@example.com', displayName: null, role: m.role, amr: 'google' }));
  await page.route(/\/api\/access\/users(\/\d+)?$/, async (r) => {
    const req = r.request();
    const id = Number(new URL(req.url()).pathname.split('/')[4] ?? 0);
    const body = req.postDataJSON() as Record<string, string> | null;
    if (req.method() === 'GET') return m.listStatus === 200 ? ok(r, { users: m.users }) : fail(r, m.listStatus, m.listStatus === 403 ? 'forbidden' : 'db_unavailable');
    if (req.method() === 'POST') {
      if (m.post) return fail(r, m.post.status, m.post.code);
      const u = user({ id: 10, email: body?.email ?? '', status: 'invited' });
      m.users.push(u);
      return ok(r, { user: u }, 201);
    }
    if (req.method() === 'PATCH') {
      m.patches.push({ id, ...body });
      const u = m.users.find((x) => x.id === id) as U;
      if (u.role === 'owner') return fail(r, 409, 'owner_protected');
      u.status = body?.status as U['status'];
      return ok(r, { user: u });
    }
    m.deletes.push({ id, ...body });
    const u = m.users.find((x) => x.id === id) as U;
    if (body?.confirmEmail !== u.email) return fail(r, 400, 'confirm_mismatch');
    m.users = m.users.filter((x) => x.id !== id);
    return ok(r, { deleted: true });
  });
  await page.goto('/access');
  return m;
}

test.describe('/login', () => {
  test('кнопка Google ведёт на /api/auth/google с next', async ({ page }) => {
    await page.goto('/login?next=%2Fstats');
    const link = page.getByRole('link', { name: 'Войти через Google' });
    await expect(link).toHaveAttribute('href', '/api/auth/google?next=%2Fstats');
    await expect(page.getByTestId('login-error')).toHaveCount(0);
  });

  for (const [code, text] of [
    ['access_denied', 'Не удалось войти. Если вы ждёте доступ, обратитесь к владельцу'],
    ['oauth_failed', 'Вход через Google не удался'],
    ['rate_limited', 'Слишком много попыток'],
  ] as const) {
    test(`?error=${code} показывает текст`, async ({ page }) => {
      await page.goto(`/login?error=${code}`);
      await expect(page.getByRole('alert')).toContainText(text);
    });
  }

  test('неизвестный error не выводится; пароль свёрнут', async ({ page }) => {
    await page.goto('/login?error=%3Cb%3Ex%3C%2Fb%3E');
    await expect(page.getByTestId('login-error')).toHaveCount(0);
    await expect(page.getByLabel('Пароль')).toBeHidden();
    await page.getByText('Аварийный вход владельца').click();
    await expect(page.getByLabel('Пароль')).toBeVisible();
  });
});

test.describe('Доступ', () => {
  test('список: роли, статусы, PSN, число игр; owner без действий', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await expect(page.getByRole('heading', { name: 'Доступ', level: 1 })).toBeVisible();
    const rows = page.getByTestId('access-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('Владелец');
    await expect(rows.first()).toContainText('214');
    await expect(rows.first().getByRole('button')).toHaveCount(0);
    await expect(rows.nth(1)).toContainText('Заблокирован');
    await expect(rows.nth(2)).toContainText('Приглашён');
  });

  test('добавление email, и ошибки multiuser_not_ready / user_exists / user_limit', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL as string, { post: { status: 409, code: 'multiuser_not_ready' } });
    const input = page.getByPlaceholder('name@gmail.com');
    await input.fill('new@example.com');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Добавление участников пока отключено.');
    m.post = { status: 409, code: 'user_exists' };
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('уже в списке');
    m.post = { status: 409, code: 'user_limit' };
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('предел');
    m.post = null;
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(page.getByTestId('access-row')).toHaveCount(4);
    await expect(input).toHaveValue('');
  });

  test('блокировка и разблокировка', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL as string);
    await page.getByRole('button', { name: /Разблокировать/ }).click();
    await expect(page.getByTestId('access-row').nth(1)).toContainText('Активен');
    expect(m.patches).toEqual([{ id: 2, status: 'active' }]);
    await page.getByRole('button', { name: /Заблокировать/ }).first().click();
    expect(m.patches[1]).toEqual({ id: 2, status: 'blocked' });
  });

  test('удаление требует ввода email; у активного кнопки удаления нет', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL as string, { users: [owner, user({ id: 2, email: 'bob@example.com', status: 'blocked' }), user({ id: 4, email: 'al@example.com' })] });
    await expect(page.getByRole('button', { name: /Удалить/ })).toHaveCount(1);
    await page.getByRole('button', { name: /Удалить/ }).click();
    const confirm = page.getByRole('button', { name: 'Удалить навсегда' });
    await expect(confirm).toBeDisabled();
    await page.getByLabel('Email для подтверждения').fill('bob@example.com');
    await confirm.click();
    await expect(page.getByTestId('access-row')).toHaveCount(2);
    expect(m.deletes).toEqual([{ id: 2, confirmEmail: 'bob@example.com' }]);
  });

  test('member (403) видит 404; ошибка сервера даёт «Повторить»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, { listStatus: 403, role: 'member' });
    await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible();
  });

  test('ошибка загрузки: панель и повтор', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL as string, { listStatus: 503 });
    await expect(page.getByRole('heading', { name: 'Список не загрузился' })).toBeVisible();
    m.listStatus = 200;
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByTestId('access-row')).toHaveCount(3);
  });

  test('меню профиля: «Доступ» у owner, нет у member; мобильная вёрстка без горизонтального скролла', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await page.getByRole('button', { name: /Профиль|Меню профиля/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Доступ' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 375, height: 720 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('меню профиля у member без «Доступ»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, { role: 'member', listStatus: 403 });
    await page.getByRole('button', { name: /Профиль|Меню профиля/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Доступ' })).toHaveCount(0);
  });
});
