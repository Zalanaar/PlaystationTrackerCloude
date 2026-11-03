// Фаза 35 (frontend): страница «Здоровье». API эмулируется по контракту F35.1.
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const NOW = new Date().toISOString();
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const cell = (used: number, limit: number | null) => ({ used, limit });

const overview = () => ({
  generatedAt: NOW, day: '2026-11-01',
  multiuser: { enabled: false, maxUsers: 10, activeProfiles: 2 },
  limits: {
    rawg: { state: 'active', userLimit: 60, totalLimit: 300, userSource: 'default', totalSource: 'default', keyConfigured: true },
    hltb: { state: 'active', userLimit: 1, totalLimit: 1000, userSource: 'clamped', totalSource: 'default' },
    llm: { state: 'disabled', reason: 'no_key', userLimit: 12, totalLimit: 60, userSource: 'default', totalSource: 'default', provider: 'groq' },
  },
  psnToken: { issuedAt: ago(8 * 24), ageSeconds: 8 * 86400, source: 'pasted', lastEvent: { event: 'refreshed', at: ago(2), details: {} } },
  users: [
    {
      id: 1, loginId: 1, isPrimary: true, role: 'owner', status: 'active', label: 'Target', email: 'owner@example.com', psnOnlineId: 'Target',
      psnAccessStatus: 'ok', psnAccessCheckedAt: ago(5), onboardedAt: ago(500), lastLoginAt: ago(3),
      sync: { lastSuccessAt: ago(4), lastAttemptAt: ago(4), recentErrors: [{ id: 41, kind: 'daily', status: 'failed', errorReason: 'auth_expired', startedAt: ago(30) }] },
      usage: { rawg: cell(3, 60), hltb: cell(0, 1), llm: cell(2, null) },
    },
    {
      id: 2, loginId: 2, isPrimary: true, role: 'member', status: 'active', label: null, email: 'bob@example.com', psnOnlineId: 'bob_psn',
      psnAccessStatus: 'private', psnAccessCheckedAt: null, onboardedAt: null, lastLoginAt: null,
      sync: { lastSuccessAt: null, lastAttemptAt: null, recentErrors: [] },
      usage: { rawg: cell(0, 60), hltb: cell(0, 1), llm: cell(0, null) },
    },
  ],
  totals: { rawg: cell(3, 300), hltb: cell(0, 1000), llm: cell(2, null) },
  criteria: {
    summary: { pass: 1, fail: 1, pending: 1, manual: 1 },
    items: [
      { id: 'owner_ready', title: 'Владелец готов', status: 'pass', detail: 'Всё в порядке.' },
      { id: 'env_sync_origin', title: 'SYNC_ORIGIN задан', status: 'fail', detail: 'Не задан.' },
      { id: 'observation_sync', title: 'Наблюдение за синком', status: 'pending', detail: 'Только после включения.' },
      { id: 'ci_green', title: 'CI зелёный', status: 'manual', detail: 'Проверяет QA.' },
    ],
  },
});

type Opts = { role?: 'owner' | 'member'; status?: number; data?: unknown };

async function open(page: Page, context: BrowserContext, baseURL: string, o: Opts = {}, goto = true) {
  const role = o.role ?? 'owner';
  const status = o.status ?? (role === 'owner' ? 200 : 403);
  await context.addCookies([{ name: 'pst_session', value: await signedSession({ role }), url: baseURL }]);
  await mockApi(page, []);
  await page.route('**/api/auth/me', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { id: role === 'owner' ? 1 : 2, email: 'x@example.com', displayName: null, role, amr: 'google' } }) }));
  let calls = 0;
  await page.route('**/api/health/overview', (r: Route) => {
    calls++;
    if (status === 200) return r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: true, data: o.data ?? overview() }) });
    return r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: status === 403 ? 'forbidden' : 'db_unavailable', message: 'x' } }) });
  });
  if (goto) await page.goto('/health');
  return { calls: () => calls };
}

async function openMenu(page: Page, isMobile: boolean) {
  await page.getByRole('button', { name: isMobile ? 'Меню' : /Профиль|Меню профиля/, exact: isMobile }).click();
}
const item = (page: Page, isMobile: boolean) => (isMobile ? page.getByRole('link', { name: 'Здоровье' }) : page.getByRole('menuitem', { name: 'Здоровье' }));
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('Здоровье', () => {
  test('owner: критерии сверху, токен, профили, потолки честно', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await expect(page.getByRole('heading', { name: 'Здоровье', level: 1 })).toBeVisible();
    const crit = page.getByTestId('health-criteria');
    await expect(crit).toContainText('MULTIUSER_ENABLED=1');
    await expect(page.getByTestId('criterion-owner_ready')).toContainText('Выполнено');
    await expect(page.getByTestId('criterion-env_sync_origin')).toContainText('Не выполнено');
    await expect(page.getByTestId('criterion-observation_sync')).toContainText('Ждёт включения');
    await expect(page.getByTestId('criterion-ci_green')).toContainText('Проверить вручную');
    // критерии выше токена и профилей
    const y = async (id: string) => (await page.getByTestId(id).boundingBox())?.y ?? 0;
    expect(await y('health-criteria')).toBeLessThan(await y('health-token'));
    expect(await y('health-token')).toBeLessThan(await y('health-users'));
    // токен 8 суток: предупреждение
    await expect(page.getByTestId('health-token')).toContainText('8 дн.');
    await expect(page.getByTestId('health-token')).toContainText('скоро истечёт');
    // выключенный LLM не выглядит безлимитом, clamped объяснён
    await expect(page.getByTestId('limit-llm-state')).toContainText('Выключено');
    await expect(page.getByTestId('limit-llm-state')).toContainText('Запросы не выполняются');
    await expect(page.getByTestId('limit-hltb')).toContainText('приведено к границе');
    // профили
    await expect(page.getByTestId('health-user-1')).toContainText('Target');
    await expect(page.getByTestId('health-user-1')).toContainText('токен PSN устарел');
    await expect(page.getByTestId('health-user-2')).toContainText('Профиль закрыт');
    await expect(page.getByTestId('health-user-2')).toContainText('не было');
    await expect(page.getByTestId('health-run-error')).toHaveCount(1);
  });

  test('owner: пункт в меню профиля ведёт на страницу', async ({ page, context, baseURL, isMobile }) => {
    await open(page, context, baseURL as string, {}, false);
    await page.goto('/stats');
    await openMenu(page, isMobile);
    await expect(item(page, isMobile)).toBeVisible();
    await item(page, isMobile).click();
    await expect(page).toHaveURL(/\/health$/);
    await expect(page.getByTestId('health-criteria')).toBeVisible();
  });

  test('member: пункта нет, прямой заход = 404 без данных', async ({ page, context, baseURL, isMobile }) => {
    const m = await open(page, context, baseURL as string, { role: 'member' }, false);
    await page.goto('/stats');
    await openMenu(page, isMobile);
    await expect(item(page, isMobile)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.goto('/health');
    await expect(page.getByRole('heading', { name: 'Страница не найдена' })).toBeVisible();
    await expect(page.getByTestId('health-criteria')).toHaveCount(0);
    await expect(page.getByText('owner@example.com')).toHaveCount(0);
    expect(m.calls()).toBeGreaterThan(0);
  });

  test('ошибка API не роняет страницу, «Повторить» работает', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, { status: 503 });
    await expect(page.getByTestId('health-error')).toContainText('База данных недоступна');
    await expect(page.getByRole('heading', { name: 'Здоровье', level: 1 })).toBeVisible();
    await page.unroute('**/api/health/overview');
    await page.route('**/api/health/overview', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: overview() }) }));
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByTestId('health-criteria')).toBeVisible();
  });

  test('состояние загрузки видно до ответа', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, {}, false);
    await page.unroute('**/api/health/overview');
    await page.route('**/api/health/overview', async (r) => {
      await new Promise((res) => setTimeout(res, 800));
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: overview() }) });
    });
    await page.goto('/health');
    await expect(page.getByTestId('health-loading')).toBeAttached();
    await expect(page.getByTestId('health-criteria')).toBeVisible();
  });

  for (const w of [320, 412]) {
    test(`вёрстка ${w} px без горизонтального скролла`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await open(page, context, baseURL as string);
      await expect(page.getByTestId('health-users')).toBeVisible();
      expect(await noHScroll(page)).toBe(true);
    });
  }

  test('темы: страница читаема во всех 7 темах', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    for (const t of ['graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5', 'night']) {
      await page.evaluate((v) => (v === 'night' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', v)), t);
      await expect(page.getByTestId('health-criteria')).toBeVisible();
      expect(await noHScroll(page)).toBe(true);
    }
  });
});
