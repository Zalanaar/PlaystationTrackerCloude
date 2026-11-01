// Фаза 24: вставка NPSSO на панели синка. API эмулируется (контракт 27), PSN не вызывается.
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { signedSession } from './session';

const SECRET = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4Y5z6A7b8C9d0E1f2';
const TOKEN = { issuedAt: '2026-10-22T10:00:00.000Z', ageSeconds: 9 * 86400 + 100, source: 'pasted', lastEvent: { event: 'expired', at: '2026-11-01T10:00:00.000Z', details: { reason: 'auth_expired' } } };

type Cfg = { role?: 'owner' | 'member'; expired?: boolean; token?: unknown; post?: { status: number; code?: string; retry?: number } };

async function open(page: Page, context: BrowserContext, baseURL: string, cfg: Cfg = {}) {
  const calls: { body: string; ct: string | undefined }[] = [];
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  let expired = cfg.expired ?? true;
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/auth/me', (r) => json(r, { ok: true, data: { id: 1, email: 'a@example.com', displayName: null, role: cfg.role ?? 'owner', amr: 'password' } }));
  await page.route('**/api/sync/status', (r) => json(r, { ok: true, data: {
    totals: null, running: false, lastSuccessAt: '2026-10-27T05:00:00.000Z', psnAuthExpiresAt: null,
    psnAuth: expired ? 'auth_expired' : 'ok', run: null, psnToken: cfg.token === undefined ? TOKEN : cfg.token,
  } }));
  await page.route('**/api/sync/npsso', (r) => {
    calls.push({ body: r.request().postData() ?? '', ct: r.request().headers()['content-type'] });
    const p = cfg.post;
    if (!p || p.status === 200) { expired = false; return json(r, { ok: true, data: { accepted: true, refreshExpiresAt: null, token: null } }); }
    return json(r, { ok: false, error: { code: p.code, message: 'x', ...(p.retry ? { details: { retryAfterSeconds: p.retry } } : {}) } }, p.status);
  });
  await page.route('**/api/games**', (r) => json(r, { ok: true, data: { items: [], total: 0 } }));
  await page.goto('/stats');
  await page.getByRole('button', { name: /Открыть синк/ }).click();
  await expect(page.getByRole('heading', { name: 'Синхронизация с PSN' })).toBeVisible();
  return { calls, logs };
}

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test.describe('Фаза 24: NPSSO с сайта', () => {
  test('owner вставляет валидный NPSSO: принято, поле пустое, значения нет в DOM и консоли', async ({ page, context, baseURL }) => {
    const { calls, logs } = await open(page, context, baseURL as string);
    const input = page.getByLabel('Вставить NPSSO');
    await expect(input).toHaveAttribute('type', 'password');
    await expect(input).toHaveAttribute('autocomplete', 'off');
    await expect(page.getByTestId('psn-token')).toContainText('9 дней назад');
    await expect(page.getByTestId('psn-token')).toContainText('с сайта');
    await input.fill(SECRET);
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByTestId('npsso-result')).toContainText('Принято');
    await expect(page.getByTestId('npsso-result').getByRole('button', { name: 'Синк сейчас' })).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0].ct).toContain('application/json');
    expect(JSON.parse(calls[0].body)).toEqual({ npsso: SECRET });
    await expect(input).toHaveValue('');
    expect(await page.content()).not.toContain(SECRET);
    expect(logs.join('\n')).not.toContain(SECRET);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain(SECRET);
    await expect(page.getByText('Нужен новый NPSSO')).toHaveCount(0); // баннер ушёл после обновления статуса
  });

  test('JSON с ssocookie уходит как есть', async ({ page, context, baseURL }) => {
    const { calls } = await open(page, context, baseURL as string);
    await page.getByLabel('Вставить NPSSO').fill(`{"npsso":"${SECRET}"}`);
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByTestId('npsso-result')).toContainText('Принято');
    expect(JSON.parse(calls[0].body)).toEqual({ npsso: `{"npsso":"${SECRET}"}` });
  });

  for (const c of [
    { name: '422', post: { status: 422, code: 'npsso_invalid' }, text: 'PSN отклонил NPSSO' },
    { name: '400', post: { status: 400, code: 'invalid_request' }, text: 'Неверный формат' },
    { name: '429', post: { status: 429, code: 'rate_limited', retry: 600 }, text: 'через 10 мин' },
    { name: '503', post: { status: 503, code: 'psn_unavailable' }, text: 'недоступны' },
    { name: '500', post: { status: 500, code: 'config_error' }, text: 'Не удалось сохранить NPSSO' },
  ]) {
    test(`ошибка ${c.name}: фиксированный текст без значения, поле очищено`, async ({ page, context, baseURL }) => {
      const { logs } = await open(page, context, baseURL as string, { post: c.post });
      await page.getByLabel('Вставить NPSSO').fill(SECRET);
      await page.getByRole('button', { name: 'Сохранить' }).click();
      await expect(page.getByTestId('npsso-result')).toContainText(c.text);
      await expect(page.getByLabel('Вставить NPSSO')).toHaveValue('');
      expect(await page.content()).not.toContain(SECRET);
      expect(logs.join('\n')).not.toContain(SECRET);
      await expect(page.getByText('Нужен новый NPSSO')).toBeVisible();
    });
  }

  test('member: баннер есть, поля нет', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, { role: 'member' });
    await expect(page.getByText('Нужен новый NPSSO')).toBeVisible();
    await expect(page.getByLabel('Вставить NPSSO')).toHaveCount(0);
    await expect(page.getByText('вставить может только он')).toBeVisible();
  });

  test('psnToken = null: блока нет; мобильная вёрстка без горизонтального скролла', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, { token: null });
    await expect(page.getByTestId('psn-token')).toHaveCount(0);
    for (const w of [360, 320]) {
      await page.setViewportSize({ width: w, height: 700 });
      await noOverflow(page);
      await expect(page.getByLabel('Вставить NPSSO')).toBeVisible();
    }
  });
});
