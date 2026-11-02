// QA Фазы 24: снимки панели синка с полем NPSSO в 7 темах (owner/member, ошибка, 360 и 320) и меню «…» Бэклога внизу (QA-33-1). Без SHOTS_DIR пропускается.
// Запуск: SHOTS_DIR=docs/qa/phase-24 PW_CHROMIUM_PATH=/usr/bin/google-chrome QA_PORT=3352 npx playwright test -c e2e/qa.config.ts e2e/qa-phase24-shots.spec.ts --project=desktop
import { test, expect, type Page, type Route } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { signedSession } from './session';

const SHOTS = process.env.SHOTS_DIR;
test.skip(!SHOTS, 'нужен SHOTS_DIR');
const THEMES = ['night', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5', 'graphite'] as const;
const setTheme = (page: Page, v: string) => page.evaluate((t) => { if (t === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }, v);
const noH = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const tourStub = JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } });
const TOKEN = { issuedAt: '2026-10-22T10:00:00.000Z', ageSeconds: 9 * 86400 + 100, source: 'pasted', lastEvent: { event: 'expired', at: '2026-11-01T10:00:00.000Z', details: { reason: 'auth_expired' } } };
// Заведомо фиктивное значение формата NPSSO (64 латинских буквы и цифры), не похожее на настоящий токен
const SECRET = 'E2EFAKENPSSO'.padEnd(64, '0');

async function open(page: Page, role: 'owner' | 'member', post?: number) {
  const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: tourStub }));
  await page.route('**/api/auth/me', (r) => json(r, { ok: true, data: { id: 1, email: 'a@example.com', displayName: null, role, amr: 'password' } }));
  await page.route('**/api/sync/status', (r) => json(r, { ok: true, data: { totals: null, running: false, lastSuccessAt: '2026-10-27T05:00:00.000Z', psnAuthExpiresAt: null, psnAuth: 'auth_expired', run: null, psnToken: TOKEN } }));
  await page.route('**/api/sync/npsso', (r) => json(r, { ok: false, error: { code: post === 429 ? 'rate_limited' : 'npsso_invalid', message: 'x', ...(post === 429 ? { details: { retryAfterSeconds: 600 } } : {}) } }, post ?? 422));
  await page.route('**/api/games**', (r) => json(r, { ok: true, data: { items: [], total: 0 } }));
  await page.goto('/stats');
  await page.getByRole('button', { name: /Открыть синк/ }).click();
  await expect(page.getByRole('heading', { name: 'Синхронизация с PSN' })).toBeVisible();
}

for (const theme of THEMES) {
  test(`sync panel ${theme}`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL as string }]);
    for (const [w, h] of [[1280, 800], [360, 740], [320, 640]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await open(page, 'owner', 422);
      await setTheme(page, theme);
      expect(await noH(page)).toBeLessThanOrEqual(0);
      if (w !== 1280) {
        await page.getByLabel('Вставить NPSSO').fill(SECRET);
        await page.getByRole('button', { name: 'Сохранить' }).click();
        await expect(page.getByTestId('npsso-result')).toContainText('PSN отклонил');
        expect(await noH(page)).toBeLessThanOrEqual(0);
      }
      await page.getByLabel('Вставить NPSSO').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/sync-${w}-${theme}.png` });
    }
    await page.setViewportSize({ width: 360, height: 740 });
    await open(page, 'member');
    await setTheme(page, theme);
    expect(await noH(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/sync-member-360-${theme}.png` });
  });
}

const bl = (id: number, title: string): G => ({ id, title, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null });
for (const theme of THEMES) {
  test(`backlog menu bottom ${theme}`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL as string }]);
    await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: tourStub }));
    await mockApi(page, Array.from({ length: 8 }, (_, i) => bl(i + 1, `Игра ${i + 1}`)));
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/backlog');
    await page.locator('.ps-blrow').first().waitFor();
    await setTheme(page, theme);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.getByRole('button', { name: 'Действия: Игра 8' }).click();
    const menu = page.getByRole('menu').first();
    await expect(menu).toBeVisible();
    await page.waitForTimeout(600);
    const tab = (await page.locator('.ps-tabbar').boundingBox())!;
    const last = (await menu.getByRole('menuitem').last().boundingBox())!;
    await page.screenshot({ path: `${SHOTS}/backlog-menu-bottom-${theme}.png` });
    expect(last.y + last.height).toBeLessThanOrEqual(tab.y + 0.5);
  });
}
