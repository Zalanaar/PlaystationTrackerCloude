// QA Фазы 29: блок «Сводка в Telegram» на 320 и 390: нет горизонтального скролла, код в одну строку, кнопки >= 44.
import { test, expect, type Page, type Route } from '@playwright/test';
import { signedSession } from './session';

const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function open(page: Page, baseURL: string, state: Record<string, unknown>) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.route('**/api/auth/me', (r) => json(r, { ok: true, data: { id: 1, email: 'a@example.com', displayName: null, role: 'member', amr: 'password' } }));
  await page.route('**/api/sync/status', (r) => json(r, { ok: true, data: { totals: null, running: false, lastSuccessAt: null, psnAuthExpiresAt: null, psnAuth: 'ok', run: null, psnToken: null } }));
  await page.route('**/api/games**', (r) => json(r, { ok: true, data: { items: [], total: 0 } }));
  await page.route('**/api/me/telegram/link', (r) => json(r, { ok: true, data: { code: 'K7M2QX9H', expiresAt: new Date(Date.now() + 900_000).toISOString(), deepLink: 'https://t.me/ps_tracker_bot?start=K7M2QX9H' } }));
  await page.route('**/api/me/telegram', (r) => json(r, { ok: true, data: { botConfigured: true, botUsername: 'ps_tracker_bot', role: 'member', linked: false, linkedAt: null, deliversTo: 'none', lastSentAt: null, pendingCode: null, ...state } }));
  await page.goto('/stats');
  await page.getByRole('button', { name: /Открыть синк/ }).click();
  return page.getByTestId('tg-digest');
}

for (const w of [320, 390]) {
  test(`QA-29: ширина ${w}, код и подключено`, async ({ page, baseURL }, info) => {
    test.skip(info.project.name !== 'mobile', 'один проект');
    await page.setViewportSize({ width: w, height: 800 });
    const panel = await open(page, baseURL as string, {});
    await panel.getByRole('button', { name: 'Привязать Telegram' }).click();
    const code = panel.getByTestId('tg-code');
    await expect(code).toBeVisible();
    const cb = await code.boundingBox();
    expect(cb?.height ?? 99).toBeLessThanOrEqual(30);
    const over = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await over()).toBeLessThanOrEqual(0);
    const pb = await panel.boundingBox();
    expect((cb?.x ?? 0) + (cb?.width ?? 0)).toBeLessThanOrEqual((pb?.x ?? 0) + (pb?.width ?? 0));
    for (const b of await panel.getByRole('button').all()) expect((await b.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `/tmp/claude-0/-home-user-PlaystationTrackerCloude/0f87726b-7ab7-5ae0-8f0f-c663e55c1ef5/scratchpad/tg-${w}.png` });
  });
}
