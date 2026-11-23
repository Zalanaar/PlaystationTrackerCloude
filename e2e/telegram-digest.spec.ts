// «Сводка в Telegram» убрана из UI (решение 23.11). Панель не показывается в настройках и в листе синка.
import { test, expect, type Page, type Route } from '@playwright/test';
import { signedSession } from './session';
import { emptyGamesBody } from './collection-mock';

async function auth(page: Page, baseURL: string) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/auth/me', (r) => json(r, { ok: true, data: { id: 1, email: 'a@example.com', displayName: null, role: 'owner', amr: 'password' } }));
  await page.route('**/api/sync/status', (r) => json(r, { ok: true, data: { totals: null, running: false, lastSuccessAt: null, psnAuthExpiresAt: null, psnAuth: 'ok', run: null, psnToken: null } }));
  await page.route('**/api/games**', (r) => json(r, emptyGamesBody(r.request().url())));
  await page.route('**/api/me/telegram', (r) => json(r, { ok: true, data: { botConfigured: true, botUsername: 'ps_tracker_bot', role: 'owner', linked: false, linkedAt: null, deliversTo: 'none', lastSentAt: null, pendingCode: null } }));
  await page.route('**/api/me/push', (r) => json(r, { ok: true, data: { configured: false, publicKey: null, devices: 0, shelvedReminder: true } }));
}

test('в настройках и в листе синка блока «Сводка в Telegram» нет', async ({ page, baseURL }) => {
  await auth(page, baseURL as string);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
  await expect(page.getByTestId('tg-digest')).toHaveCount(0);
  await expect(page.getByText('Сводка в Telegram')).toHaveCount(0);

  await page.goto('/stats');
  await page.getByRole('button', { name: /Открыть синк/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Синхронизация с PSN' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId('sync-panel')).toBeVisible();
  await expect(dlg.getByTestId('tg-digest')).toHaveCount(0);
  await expect(dlg.getByText('Сводка в Telegram')).toHaveCount(0);
});
