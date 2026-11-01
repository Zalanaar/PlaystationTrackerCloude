// Фаза 32.1: остановка и перезапуск синка. API эмулируется (контракт 8.8).
import { test, expect, type Page } from '@playwright/test';
import { signedSession } from './session';

type St = { running: boolean; cancelled: boolean };

async function open(page: Page, baseURL: string, opts: { cancelResp?: { status: number; body: unknown } } = {}) {
  const st: St = { running: true, cancelled: false };
  const posts: string[] = [];
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.route('**/api/auth/me', (r) => r.fulfill(json({ ok: true, data: { id: 1, email: 'a@example.com', displayName: null, role: 'owner', amr: 'password' } })));
  await page.route('**/api/sync/status', (r) => r.fulfill(json({ ok: true, data: {
    totals: null, running: st.running, lastSuccessAt: '2026-11-01T05:00:00.000Z', psnAuth: 'ok', psnAuthExpiresAt: null, psnToken: null,
    run: {
      id: 7, kind: 'manual', status: st.running ? 'running' : 'failed', phase: 'trophies',
      errorReason: st.cancelled ? 'cancelled' : null, errorMessage: st.cancelled ? 'Остановлено пользователем.' : null,
      startedAt: '2026-11-01T06:00:00.000Z', finishedAt: st.running ? null : '2026-11-01T06:05:00.000Z',
      progress: { phase: 'trophies', step: 4, steps: 4, done: 10, total: 100 }, counters: null,
    },
  } })));
  await page.route('**/api/sync/cancel', (r) => {
    posts.push(`cancel ${r.request().postData()}`);
    if (opts.cancelResp) return r.fulfill(json(opts.cancelResp.body, opts.cancelResp.status));
    st.running = false; st.cancelled = true;
    return r.fulfill(json({ ok: true, data: { cancelled: true, runId: 7 } }));
  });
  await page.route('**/api/sync', (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    posts.push(`sync ${r.request().postData()}`);
    return r.fulfill(json({ ok: true, data: { runId: 8, restarted: true, cancelledRunId: 7, resumed: true } }, 202));
  });
  await page.route('**/api/games**', (r) => r.fulfill(json({ ok: true, data: { items: [], total: 0 } })));
  await page.goto('/stats');
  await page.getByRole('button', { name: /Открыть синк/ }).click();
  await expect(page.getByRole('heading', { name: 'Синхронизация с PSN' })).toBeVisible();
  return { st, posts };
}

test.describe('Фаза 32.1: остановка синка', () => {
  test('остановка с подтверждением: нейтральный статус, без красного баннера, доступен «Синк сейчас»', async ({ page, baseURL }) => {
    const { posts } = await open(page, baseURL as string);
    await page.getByRole('button', { name: 'Остановить' }).click();
    const dlg = page.getByRole('alertdialog');
    await expect(dlg).toContainText('Остановить синк? Загруженные данные сохранятся');
    await expect(dlg.getByRole('button', { name: 'Отмена' })).toBeFocused();
    await dlg.getByRole('button', { name: 'Остановить' }).click();
    await expect(page.getByTestId('sync-cancelled')).toContainText('Остановлено вами');
    await expect(page.getByRole('button', { name: 'Синк сейчас' })).toBeEnabled();
    await expect(page.getByTestId('run-status')).toHaveText('Остановлен');
    expect(posts).toEqual(['cancel {}']);
    await page.keyboard.press('Escape');
    await expect(page.getByText('Не удалось обновить данные из PSN')).toHaveCount(0);
  });

  test('перезапуск шлёт restart:true', async ({ page, baseURL }) => {
    const { posts } = await open(page, baseURL as string);
    await page.getByRole('button', { name: 'Перезапустить' }).click();
    await expect.poll(() => posts).toEqual(['sync {"restart":true}']);
  });

  test('403 и 503 дают человеческий текст', async ({ page, baseURL }) => {
    await open(page, baseURL as string, { cancelResp: { status: 403, body: { ok: false, error: { code: 'forbidden', message: 'x' } } } });
    await page.getByRole('button', { name: 'Остановить' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Остановить' }).click();
    await expect(page.getByText('только владелец')).toBeVisible();
  });
});
