// QA 20.5: два пользователя. API эмулируется по uid из cookie (БД в e2e нет), поэтому тест проверяет, что UI
// (а) не смешивает данные двух сессий в одном браузере, (б) ведёт member по онбордингу с нуля, (в) не показывает owner-only.
// Серверную изоляцию доказывают src/server/user-isolation*.test.ts и src/server/api-auth-roles.test.ts на PGlite.
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

const ok = (r: Route, data: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
const fail = (r: Route, status: number, code: string) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code, message: 'x' } }) });

const OWNER_ONLY_TITLES = ['Horizon Forbidden West'];
const memberGames = () => [
  { ...seed()[0], id: 501, title: 'Только у участника', status: 'backlog' as const, completedAt: null, lastPlayedAt: '2026-09-01T10:00:00.000Z', playSeconds: 3600 },
  { ...seed()[0], id: 502, title: 'Участник: играю', status: 'playing' as const, completedAt: null, lastPlayedAt: '2026-10-20T10:00:00.000Z', playSeconds: 7200 },
];

async function login(context: BrowserContext, baseURL: string, uid: number, role: 'owner' | 'member') {
  await context.addCookies([{ name: 'pst_session', value: await signedSession({ uid, role }), url: baseURL }]);
}

async function whoAmI(page: Page, uid: number, role: 'owner' | 'member') {
  await page.route('**/api/auth/me', (r) => ok(r, { id: uid, email: `u${uid}@example.com`, displayName: null, role, amr: 'google' }));
  await page.route(/\/api\/access\/users(\/\d+)?$/, (r) => (role === 'owner' ? ok(r, { users: [] }) : fail(r, 403, 'forbidden')));
}

test.describe('два пользователя в одном браузере', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'логика не зависит от вьюпорта; мобильный вид онбординга покрыт onboarding.spec'); });

  test('коллекция: у каждого контекста только свои игры; owner-only недоступен member', async ({ browser, baseURL }) => {
    const ownerCtx = await browser.newContext();
    const memberCtx = await browser.newContext();
    const [ownerPage, memberPage] = [await ownerCtx.newPage(), await memberCtx.newPage()];
    await login(ownerCtx, baseURL!, 1, 'owner');
    await login(memberCtx, baseURL!, 2, 'member');
    await whoAmI(ownerPage, 1, 'owner');
    await whoAmI(memberPage, 2, 'member');
    await mockApi(ownerPage, seed());
    await mockApi(memberPage, memberGames());
    // onboardedAt у участника уже есть: guard (серверный fetch без БД) fail-open, страница открывается
    await ownerPage.goto('/');
    await memberPage.goto('/');

    const text = async (p: Page) => p.locator('main').innerText();
    await expect(ownerPage.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
    await expect(memberPage.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
    await expect(memberPage.getByRole('region', { name: 'Играю' })).toContainText('Участник: играю');
    const o = await text(ownerPage);
    const m = await text(memberPage);
    expect(o).toContain('Horizon Forbidden West');
    expect(o).not.toContain('Только у участника');
    expect(m).toContain('Только у участника');
    for (const t of OWNER_ONLY_TITLES) expect(m).not.toContain(t);
    expect(m).not.toContain('Hades');

    // member: страница «Доступ» = 404, ссылки в меню нет
    await memberPage.goto('/access');
    await expect(memberPage.getByText(/404|не найден/i).first()).toBeVisible();
    await expect(memberPage.getByTestId('access-row')).toHaveCount(0);
    await ownerCtx.close();
    await memberCtx.close();
  });

  test('после выхода cookie стирается: чужие данные не видны без входа', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(ctx, baseURL!, 2, 'member');
    await ctx.clearCookies();
    await page.goto('/');
    await page.waitForURL(/\/login/);
    const api = await page.request.get(`${baseURL}/api/games`);
    expect(api.status()).toBe(401);
    await ctx.close();
  });

  test('member: онбординг с нуля (ник -> проверка -> загрузка -> готово), чужой ник занят', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(ctx, baseURL!, 2, 'member');
    let psn = { onlineId: null as string | null, accessMode: 'public', accessStatus: 'unchecked', checkedAt: null as string | null, canStartSync: false, onboardedAt: null as string | null, sync: null };
    let posts = 0;
    const puts: string[] = [];
    await page.route('**/api/me/psn', async (r) => {
      if (r.request().method() === 'GET') return ok(r, psn);
      const nick = (r.request().postDataJSON() as { onlineId: string }).onlineId;
      puts.push(nick);
      if (nick.toLowerCase() === 'artem') return fail(r, 409, 'psn_id_taken');
      psn = { ...psn, onlineId: nick, accessStatus: 'ok', canStartSync: true, checkedAt: '2026-10-31T10:00:00.000Z' };
      return ok(r, psn);
    });
    let polls = 0;
    await page.route('**/api/sync', (r) => {
      posts++;
      return ok(r, { started: true, resumed: false, run: { id: 9, kind: 'manual', status: 'running', phase: 'games' } }, 202);
    });
    await page.route('**/api/sync/status', (r) => {
      if (posts > 0) polls++;
      const done = posts > 0 && polls > 2;
      if (done) psn = { ...psn, onboardedAt: '2026-10-31T10:05:00.000Z' };
      const base = { lastSuccessAt: null, psnAuth: 'ok', psnAuthExpiresAt: null, totals: null };
      if (posts === 0) return ok(r, { running: false, run: null, ...base });
      return ok(r, { running: !done, run: { id: 9, kind: 'manual', status: done ? 'success' : 'running', phase: 'games', errorReason: null, errorMessage: null, startedAt: '2026-10-31T10:00:00.000Z', finishedAt: done ? '2026-10-31T10:05:00.000Z' : null, snapshotDate: null, progress: { phase: 'games', step: 1, steps: 4, done: null, total: null }, counters: done ? { gamesSeen: 42 } : {} }, ...base });
    });
    await page.route('**/api/auth/logout', (r) => ok(r, { loggedOut: true }));

    await page.goto('/onboarding');
    await expect(page.getByRole('heading', { name: 'Подключим PlayStation', level: 1 })).toBeVisible();
    // ник владельца занят
    await page.getByLabel('Ник PSN').fill('Artem');
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await expect(page.getByTestId('ob-result-psn_id_taken')).toContainText('уже занят');
    await page.getByRole('button', { name: 'Изменить ник' }).click();
    await page.getByLabel('Ник PSN').fill('MemberNick');
    await page.getByRole('button', { name: 'Продолжить' }).click();
    await page.getByRole('button', { name: 'Дальше: загрузить игры' }).click();
    await expect(page.getByTestId('ob-done')).toContainText('Загружено игр: 42', { timeout: 20000 });
    expect(puts).toEqual(['Artem', 'MemberNick']);
    expect(posts).toBe(1);
    await ctx.close();
  });
});
