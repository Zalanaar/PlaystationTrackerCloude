// П10 «Видимость»: журнал ошибок браузера. Необработанная ошибка уходит в POST /api/client-errors (без query в пути,
// повтор того же текста — один раз), шум не отправляется; в панели синка — счётчик за 7 дней и последние ошибки. API эмулируется.
import { test, expect, type Page } from '@playwright/test';
import { signedSession } from './session';
import { emptyGamesBody } from './collection-mock';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function setup(page: Page, baseURL: string, summary: unknown) {
  const posts: Record<string, unknown>[] = [];
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.route('**/api/auth/me', (r) => r.fulfill(json({ ok: true, data: { id: 1, email: 'a@example.com', displayName: null, role: 'owner', amr: 'password' } })));
  await page.route('**/api/sync/status', (r) => r.fulfill(json({ ok: true, data: { totals: null, running: false, lastSuccessAt: '2026-11-01T05:00:00.000Z', psnAuth: 'ok', psnAuthExpiresAt: null, psnToken: null, run: null } })));
  await page.route('**/api/games**', (r) => r.fulfill(json(emptyGamesBody(r.request().url()))));
  await page.route('**/api/client-errors', (r) => {
    if (r.request().method() === 'POST') { posts.push(JSON.parse(r.request().postData() ?? '{}')); return r.fulfill(json({ ok: true, data: { stored: true } })); }
    return r.fulfill(json({ ok: true, data: summary }));
  });
  return posts;
}

test('необработанная ошибка и отклонённый промис уходят в журнал, шум и повтор — нет', async ({ page, baseURL }) => {
  const posts = await setup(page, baseURL!, { days: 7, count: 0, recent: [] });
  await page.goto('/stats?period=year#x');
  // дождаться гидратации (журнал подключается эффектом шапки): панель синка открывается только после неё
  await page.getByRole('button', { name: /Открыть синк/ }).click();
  await expect(page.getByRole('heading', { name: 'Синхронизация с PSN' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    setTimeout(() => { throw new Error('П10 проверка журнала'); }, 0);
    setTimeout(() => { throw new Error('П10 проверка журнала'); }, 10);
    setTimeout(() => { throw new Error('ResizeObserver loop completed with undelivered notifications.'); }, 20);
    void Promise.reject(new TypeError('П10 промис'));
  });
  await expect.poll(() => posts.length).toBe(2);
  await page.waitForTimeout(300);
  expect(posts).toHaveLength(2);
  const byKind = Object.fromEntries(posts.map((p) => [p.kind, p]));
  expect(byKind.error).toMatchObject({ message: 'Error: П10 проверка журнала', path: '/stats' });
  expect(byKind.rejection).toMatchObject({ message: 'TypeError: П10 промис', path: '/stats' });
});

test('панель синка: счётчик за 7 дней и последние ошибки; ноль — спокойная строка', async ({ page, baseURL }) => {
  await setup(page, baseURL!, { days: 7, count: 4, recent: [{ at: '2026-11-15T10:00:00.000Z', kind: 'error', message: 'TypeError: x is undefined', path: '/stats' }] });
  await page.goto('/stats');
  await page.getByRole('button', { name: /Открыть синк/ }).click();
  const box = page.getByTestId('client-errors');
  await expect(box).toContainText('Ошибки в браузере за 7 дней: 4');
  await expect(box.getByRole('listitem')).toHaveCount(1);
  await expect(box.getByRole('listitem')).toContainText('/stats — TypeError: x is undefined');
});

test('панель синка: ошибок нет', async ({ page, baseURL }) => {
  await setup(page, baseURL!, { days: 7, count: 0, recent: [] });
  await page.goto('/stats');
  await page.getByRole('button', { name: /Открыть синк/ }).click();
  await expect(page.getByTestId('client-errors')).toHaveText('Ошибок в браузере за 7 дней нет');
});
