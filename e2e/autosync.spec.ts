// Идея 1 (аудит UX): автосинк при открытии, если данным больше 6 ч. Сервер эмулируется: здесь проверяем, когда клиент
// просит POST /api/sync/auto и что после запуска шапка показывает идущий синк. Реальный синк не запускается.
import { test, expect, type Page } from '@playwright/test';
import { mockApi, type Mock } from './collection-mock';
import { signedSession } from './session';

async function open(page: Page, baseURL: string, lastSuccessAt: string | null, startOk = true) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const m: Mock = await mockApi(page);
  m.syncStatus = { ...m.syncStatus, lastSuccessAt };
  const calls: string[] = [];
  await page.route('**/api/sync/auto', async (r) => {
    calls.push(r.request().method());
    if (startOk) {
      m.syncStatus = { ...m.syncStatus, running: true, run: { id: 9, kind: 'manual', status: 'running', phase: 'games', startedAt: new Date().toISOString(), finishedAt: null, errorReason: null, progress: null } };
      await r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { started: true, run: { id: 9, status: 'running' } } }) });
    } else await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { started: false, reason: 'recent' } }) });
  });
  await page.goto('/');
  await expect(page.locator('.ps-card').first()).toBeVisible();
  return { m, calls };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

test('данным 13 ч: при открытии один тихий запуск, шапка показывает идущий синк', async ({ page, baseURL }) => {
  const { calls } = await open(page, baseURL!, hoursAgo(13));
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0]).toBe('POST');
  await expect(page.locator('.ps-btn--sync').first()).toHaveAttribute('data-tone', 'busy');
  // повторное открытие в течение 30 мин с этого устройства — сервер не спрашиваем
  await page.reload();
  await expect(page.locator('.ps-card').first()).toBeVisible();
  await page.waitForTimeout(800);
  expect(calls.length).toBe(1);
});

test('данным 2 ч — запроса нет', async ({ page, baseURL }) => {
  const { calls } = await open(page, baseURL!, hoursAgo(2));
  await page.waitForTimeout(1200);
  expect(calls).toEqual([]);
});

test('ни одного синка (онбординг) — запроса нет', async ({ page, baseURL }) => {
  const { calls } = await open(page, baseURL!, null);
  await page.waitForTimeout(1200);
  expect(calls).toEqual([]);
});

test('сервер ответил «рано» — тихо, без сообщений', async ({ page, baseURL }) => {
  const { calls } = await open(page, baseURL!, hoursAgo(30), false);
  await expect.poll(() => calls.length).toBe(1);
  await expect(page.getByText(/Не удалось запустить синк/)).toHaveCount(0);
});
