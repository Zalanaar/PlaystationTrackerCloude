// Фаза 29: блок «Сводка в Telegram» на панели синка. API эмулируется (контракт, раздел «Фаза 29»).
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { signedSession } from './session';
import { emptyGamesBody } from './collection-mock';

type St = {
  botConfigured: boolean; botUsername: string | null; role: 'owner' | 'member'; linked: boolean; linkedAt: string | null;
  deliversTo: 'own_chat' | 'alerts_chat' | 'none'; lastSentAt: string | null; pendingCode: { expiresAt: string } | null;
};
const BASE: St = { botConfigured: true, botUsername: 'ps_tracker_bot', role: 'member', linked: false, linkedAt: null, deliversTo: 'none', lastSentAt: null, pendingCode: null };

type Cfg = { state?: Partial<St>; getFail?: boolean; post?: { status: number; code?: string; ttlMs?: number }; getDelay?: number };

async function open(page: Page, context: BrowserContext, baseURL: string, cfg: Cfg = {}) {
  let st: St = { ...BASE, ...cfg.state };
  const calls = { get: 0, post: 0, del: 0 };
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/auth/me', (r) => json(r, { ok: true, data: { id: 1, email: 'a@example.com', displayName: null, role: st.role, amr: 'password' } }));
  await page.route('**/api/sync/status', (r) => json(r, { ok: true, data: { totals: null, running: false, lastSuccessAt: null, psnAuthExpiresAt: null, psnAuth: 'ok', run: null, psnToken: null } }));
  await page.route('**/api/games**', (r) => json(r, emptyGamesBody(r.request().url())));
  await page.route('**/api/me/telegram/link', async (r) => {
    calls.post++;
    const p = cfg.post ?? { status: 200 };
    if (p.status !== 200) return json(r, { ok: false, error: { code: p.code ?? 'x', message: 'x' } }, p.status);
    const expiresAt = new Date(Date.now() + (p.ttlMs ?? 15 * 60_000)).toISOString();
    st = { ...st, pendingCode: { expiresAt } };
    return json(r, { ok: true, data: { code: 'K7M2QX9H', expiresAt, deepLink: 'https://t.me/ps_tracker_bot?start=K7M2QX9H' } });
  });
  await page.route('**/api/me/telegram', async (r) => {
    const m = r.request().method();
    if (m === 'DELETE') { calls.del++; st = { ...st, linked: false, deliversTo: 'none', pendingCode: null }; return json(r, { ok: true, data: { linked: false } }); }
    calls.get++;
    if (cfg.getDelay) await new Promise((x) => setTimeout(x, cfg.getDelay));
    if (cfg.getFail) return json(r, { ok: false, error: { code: 'db_unavailable', message: 'x' } }, 503);
    return json(r, { ok: true, data: st });
  });
  await page.goto('/stats');
  await page.getByRole('button', { name: /Открыть синк/ }).click();
  const panel = page.getByTestId('tg-digest');
  return { panel, calls, link: () => { st = { ...st, linked: true, deliversTo: 'own_chat', pendingCode: null, linkedAt: new Date().toISOString() }; } };
}

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test.describe('Фаза 29: Сводка в Telegram', () => {
  // Пакет 6, п. 3: время по часам устройства; пояс контекста фиксирован, чтобы не зависеть от машины CI
  test.use({ timezoneId: 'Europe/Vilnius' });
  test('загрузка: скелетон, затем «Не подключено»', async ({ page, context, baseURL }) => {
    const { panel } = await open(page, context, baseURL as string, { getDelay: 600 });
    await expect(panel.locator('.ps-skeleton').first()).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Привязать Telegram' })).toBeDisabled();
    await expect(panel.getByTestId('tg-status')).toContainText('Не подключено');
    await expect(panel.getByRole('button', { name: 'Привязать Telegram' })).toBeEnabled();
    await expect(panel).toContainText('в воскресенье вечером:');
    await noOverflow(page);
  });

  test('создание кода: код, таймер, копирование, ссылка на бота', async ({ page, context, baseURL }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    const { panel } = await open(page, context, baseURL as string);
    await panel.getByRole('button', { name: 'Привязать Telegram' }).click();
    await expect(panel.getByTestId('tg-status')).toContainText('Ждём подтверждения');
    await expect(panel.getByTestId('tg-code')).toHaveText('K7M2QX9H');
    await expect(panel).toContainText('/start K7M2QX9H');
    await expect(panel.getByTestId('tg-timer')).toContainText(/Осталось 1[45]:\d\d/);
    await expect(panel.getByRole('link', { name: 'Открыть бота' })).toHaveAttribute('href', 'https://t.me/ps_tracker_bot?start=K7M2QX9H');
    const box = await panel.getByTestId('tg-code').boundingBox();
    expect(box?.height ?? 99).toBeLessThan(40); // код не переносится
    await panel.getByRole('button', { name: 'Копировать' }).click();
    await expect(panel.getByRole('button', { name: 'Скопировано' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Копировать' })).toBeVisible({ timeout: 4000 });
    await expect(panel.getByRole('button', { name: 'Новый код' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Отмена' })).toBeVisible();
    await noOverflow(page);
  });

  test('код истекает: «Код истёк» и «Новый код»', async ({ page, context, baseURL }) => {
    const { panel } = await open(page, context, baseURL as string, { post: { status: 200, ttlMs: 2500 } });
    await panel.getByRole('button', { name: 'Привязать Telegram' }).click();
    await expect(panel.getByTestId('tg-status')).toContainText('Ждём подтверждения');
    await expect(panel.getByTestId('tg-status')).toContainText('Код истёк', { timeout: 6000 });
    await expect(panel).toContainText('Создай новый код и пришли его боту.');
    await expect(panel.getByRole('button', { name: 'Новый код' })).toBeVisible();
  });

  test('опрос: после привязки в боте статус «Подключено» и «Telegram привязан.»', async ({ page, context, baseURL }) => {
    const { panel, link } = await open(page, context, baseURL as string);
    await panel.getByRole('button', { name: 'Привязать Telegram' }).click();
    await expect(panel.getByTestId('tg-code')).toBeVisible();
    link();
    await expect(panel.getByTestId('tg-status')).toContainText('Подключено', { timeout: 9000 });
    await expect(panel.getByTestId('tg-notice')).toHaveText('Telegram привязан.');
    await expect(panel).toContainText('Ещё не отправлялась');
  });

  test('подключено: дата последней сводки, отключение с подтверждением', async ({ page, context, baseURL }) => {
    const { panel, calls } = await open(page, context, baseURL as string, { state: { linked: true, deliversTo: 'own_chat', lastSentAt: '2026-10-25T16:00:12.000Z' } });
    await expect(panel.getByTestId('tg-status')).toContainText('Подключено');
    await expect(panel).toContainText('Последняя: 25 окт, 18:00'); // Пакет 6, п. 3: по часам устройства (контекст в Europe/Vilnius), без «МСК»
    await expect(panel).not.toContainText('МСК');
    await panel.getByRole('button', { name: 'Отключить' }).click();
    await expect(panel).toContainText('Отключить сводку? Привязку чата можно создать заново.');
    await panel.getByRole('button', { name: 'Отмена' }).click();
    expect(calls.del).toBe(0);
    await panel.getByRole('button', { name: 'Отключить' }).click();
    await panel.getByRole('group', { name: 'Подтверждение' }).getByRole('button', { name: 'Отключить' }).click();
    await expect(panel.getByTestId('tg-status')).toContainText('Не подключено');
    expect(calls.del).toBe(1);
  });

  test('владелец с чатом алертов: без кнопки «Отключить»', async ({ page, context, baseURL }) => {
    const { panel } = await open(page, context, baseURL as string, { state: { role: 'owner', deliversTo: 'alerts_chat' } });
    await expect(panel).toContainText('Чат задан на сервере вместе с алертами.');
    await expect(panel.getByRole('button')).toHaveCount(0);
  });

  test('бот не настроен: «Недоступно», действий нет', async ({ page, context, baseURL }) => {
    const { panel } = await open(page, context, baseURL as string, { state: { botConfigured: false } });
    await expect(panel.getByTestId('tg-status')).toContainText('Недоступно');
    await expect(panel).toContainText('Бот Telegram на сервере не настроен.');
    await expect(panel.getByRole('button')).toHaveCount(0);
  });

  for (const c of [
    { name: '503', post: { status: 503, code: 'config_error' }, text: 'Бот Telegram на сервере не настроен.' },
    { name: '429', post: { status: 429, code: 'rate_limited' }, text: 'Слишком много кодов подряд' },
    { name: '500', post: { status: 500, code: 'internal' }, text: 'Не получилось создать код. Попробуй ещё раз.' },
  ]) {
    test(`ошибка создания кода ${c.name}`, async ({ page, context, baseURL }) => {
      const { panel, calls } = await open(page, context, baseURL as string, { post: c.post });
      await panel.getByRole('button', { name: 'Привязать Telegram' }).click();
      await expect(panel.getByTestId('tg-status')).toContainText('Ошибка');
      await expect(panel).toContainText(c.text);
      await panel.getByRole('button', { name: 'Повторить' }).click();
      await expect.poll(() => calls.post).toBe(2);
    });
  }

  test('ошибка загрузки не роняет страницу: сообщение и «Повторить»', async ({ page, context, baseURL }) => {
    const { panel } = await open(page, context, baseURL as string, { getFail: true });
    await expect(panel).toContainText('Не удалось загрузить настройки Telegram.');
    await expect(panel.getByRole('button', { name: 'Повторить' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Синхронизация с PSN' })).toBeVisible();
  });

  test('мобильная: кнопки на всю ширину, высота не меньше 44', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'mobile', 'только мобильный проект');
    const { panel } = await open(page, context, baseURL as string);
    await expect(panel.getByTestId('tg-status')).toContainText('Не подключено');
    const b = panel.getByRole('button', { name: 'Привязать Telegram' });
    await b.scrollIntoViewIfNeeded();
    const [bb, pb] = [await b.boundingBox(), await panel.boundingBox()];
    expect(bb?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((bb?.width ?? 0) / (pb?.width ?? 1)).toBeGreaterThan(0.85);
  });
});
