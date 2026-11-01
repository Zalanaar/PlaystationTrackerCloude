// Фаза 32.1: остановка и перезапуск синка. API эмулируется (контракт 8.8).
import { test, expect, type Page } from '@playwright/test';
import { signedSession } from './session';
import { THEMES } from '../src/ui/tokens';

type St = { running: boolean; cancelled: boolean };

async function open(page: Page, baseURL: string, opts: { cancelResp?: { status: number; body: unknown }; restartResp?: { status: number; body: unknown }; stayRunning?: boolean } = {}) {
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
    if (opts.stayRunning) return r.fulfill(json({ ok: true, data: { cancelled: false, runId: null } }));
    st.running = false; st.cancelled = true;
    return r.fulfill(json({ ok: true, data: { cancelled: true, runId: 7 } }));
  });
  await page.route('**/api/sync', (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    posts.push(`sync ${r.request().postData()}`);
    if (opts.restartResp) return r.fulfill(json(opts.restartResp.body, opts.restartResp.status));
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

  const confirmStop = async (page: Page) => {
    await page.getByRole('button', { name: 'Остановить' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Остановить' }).click();
  };

  test('503 на остановке: текст про БД, запуск остаётся идущим, кнопки снова доступны', async ({ page, baseURL }) => {
    await open(page, baseURL as string, { cancelResp: { status: 503, body: { ok: false, error: { code: 'db_unavailable', message: 'x' } } } });
    await confirmStop(page);
    await expect(page.getByText('База данных недоступна. Попробуй позже.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Остановить' })).toBeEnabled();
    await expect(page.getByTestId('sync-cancelled')).toHaveCount(0);
  });

  test('409 sync_in_progress на перезапуске: понятный текст, без красного баннера', async ({ page, baseURL }) => {
    await open(page, baseURL as string, { restartResp: { status: 409, body: { ok: false, error: { code: 'sync_in_progress', message: 'x' } } } });
    await page.getByRole('button', { name: 'Перезапустить' }).click();
    await expect(page.getByText('занят другим запуском')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Перезапустить' })).toBeEnabled();
  });

  test('cancelled:false (запуск уже завершился): без ошибки, статус обновляется, панель живая', async ({ page, baseURL }) => {
    const { st } = await open(page, baseURL as string, { stayRunning: true });
    st.running = false; // между опросом и кликом запуск закончился сам
    await confirmStop(page);
    await expect(page.getByText(/Не удалось остановить/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Синк сейчас' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Остановить' })).toHaveCount(0);
  });

  test('двойной клик: один POST остановки и один POST перезапуска', async ({ page, baseURL }) => {
    const { posts } = await open(page, baseURL as string);
    await page.getByRole('button', { name: 'Остановить' }).click();
    const ok = page.getByRole('alertdialog').getByRole('button', { name: 'Остановить' });
    await ok.dblclick({ force: true }).catch(() => undefined);
    await expect(page.getByTestId('sync-cancelled')).toBeVisible();
    expect(posts.filter((p) => p.startsWith('cancel'))).toHaveLength(1);

    const second = await open(page, baseURL as string);
    const rb = page.getByRole('button', { name: 'Перезапустить' });
    await rb.dblclick({ force: true }).catch(() => undefined);
    await expect.poll(() => second.posts.filter((p) => p.startsWith('sync')).length).toBeGreaterThan(0);
    expect(second.posts.filter((p) => p.startsWith('sync'))).toHaveLength(1);
  });

  test('Отмена в подтверждении ничего не шлёт; Escape закрывает только подтверждение', async ({ page, baseURL }) => {
    const { posts } = await open(page, baseURL as string);
    await page.getByRole('button', { name: 'Остановить' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Отмена' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Остановить' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Синхронизация с PSN' })).toBeVisible();
    expect(posts).toEqual([]);
  });

  test('360 px: кнопки и подтверждение без горизонтального скролла, цели >= 44 px', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await open(page, baseURL as string);
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await noOverflow()).toBe(true);
    for (const n of ['Остановить', 'Перезапустить']) {
      const b = await page.getByRole('button', { name: n }).boundingBox();
      expect(b && b.height >= 44 && b.x >= 0 && b.x + b.width <= 360).toBe(true);
    }
    await page.getByRole('button', { name: 'Остановить' }).click();
    expect(await noOverflow()).toBe(true);
    for (const n of ['Остановить', 'Отмена']) {
      const b = await page.getByRole('alertdialog').getByRole('button', { name: n }).boundingBox();
      expect(b && b.height >= 44 && b.x >= 0 && b.x + b.width <= 360).toBe(true);
    }
    await page.getByRole('alertdialog').getByRole('button', { name: 'Остановить' }).click();
    await expect(page.getByTestId('sync-cancelled')).toBeVisible();
    expect(await noOverflow()).toBe(true);
  });

  for (const { id: theme } of THEMES) {
    test(`тема ${theme}: подтверждение и статус «остановлен» видны, баннера сбоя нет`, async ({ page, baseURL }) => {
      await open(page, baseURL as string);
      await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, theme);
      await page.getByRole('button', { name: 'Остановить' }).click();
      const dlg = page.getByRole('alertdialog');
      await expect(dlg).toBeVisible();
      const b = await dlg.boundingBox();
      expect(b && b.width > 0).toBe(true);
      await dlg.getByRole('button', { name: 'Остановить' }).click();
      const el = page.getByTestId('sync-cancelled');
      await expect(el).toBeVisible();
      // красной ошибки нет: шапка не показывает баннер сбоя, а цвет текста статуса не равен цвету --danger темы
      await page.keyboard.press('Escape');
      await expect(page.getByText('Не удалось обновить данные из PSN')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});
