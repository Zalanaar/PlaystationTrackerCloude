// F7 (аудит UX): экран «Настройки» — тема, уведомления, Telegram, календарь релизов, копия данных; ссылка из меню «⋯» и профиля.
import { createRequire } from 'node:module';
import { test, expect, type Page, type Route } from '@playwright/test';
import { signedSession } from './session';
import { emptyGamesBody } from './collection-mock';
import { settle } from './settle';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];

async function open(page: Page, baseURL: string, path = '/settings') {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/auth/me', (r) => json(r, { ok: true, data: { id: 1, email: 'a@example.com', displayName: null, role: 'owner', amr: 'password' } }));
  await page.route('**/api/sync/status', (r) => json(r, { ok: true, data: { totals: null, running: false, lastSuccessAt: null, psnAuthExpiresAt: null, psnAuth: 'ok', run: null, psnToken: null } }));
  await page.route('**/api/games**', (r) => json(r, emptyGamesBody(r.request().url())));
  await page.route('**/api/me/telegram', (r) => json(r, { ok: true, data: { botConfigured: false, botUsername: null, role: 'owner', linked: false, linkedAt: null, deliversTo: 'none', lastSentAt: null, pendingCode: null } }));
  await page.route('**/api/me/push', (r) => json(r, { ok: true, data: { configured: false, publicKey: null, devices: 0 } }));
  await page.route('**/api/roadmap/calendar', (r) => json(r, { ok: true, data: { active: false, createdAt: null } }));
  await page.goto(path);
}

test('экран: тема, уведомления, календарь, копия данных; смена темы', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Тема' })).toBeVisible();
  await expect(page.getByTestId('push-panel')).toBeVisible();
  await expect(page.getByTestId('settings-calendar')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Скачать копию' })).toHaveAttribute('href', '/api/backup');
  await expect(page.getByRole('button', { name: 'Восстановить из файла' })).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Тема' }).getByRole('radio', { name: 'Wave' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ps3');
});

test('ссылка «Настройки» из меню', async ({ page, baseURL, isMobile }) => {
  await open(page, baseURL!, '/');
  if (isMobile) {
    await page.getByRole('button', { name: 'Меню', exact: true }).click();
    await page.getByTestId('sheet-settings').click();
  } else {
    await page.locator('.ps-avatar').click();
    await page.getByTestId('menu-settings').click();
  }
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Настройки' })).toBeVisible();
});

for (const w of [360, 390]) {
  test(`${w} px: без горизонтального скролла, кнопки 44, axe во всех темах`, async ({ page, baseURL, isMobile }) => {
    test.skip(!isMobile, 'телефон');
    await page.setViewportSize({ width: w, height: 800 });
    await open(page, baseURL!);
    await expect(page.getByTestId('push-panel')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    for (const b of await page.locator('.ps-settings .ps-btn').all()) if (await b.isVisible()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.evaluate(axeSource);
    for (const t of THEMES) {
      await page.evaluate((th) => { if (th === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', th); }, t);
      await settle(page);
      const v = await page.evaluate(async () => (await (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe.run(document.querySelector('.ps-settings'), { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((x) => `${x.id}:${x.nodes.length}`));
      expect(v, t).toEqual([]);
    }
  });
}

test('F6: меню по группам, сброс статусов — отдельно в самом низу', async ({ page, baseURL, isMobile }) => {
  test.skip(!isMobile, 'лист «Меню» — телефон');
  await open(page, baseURL!, '/');
  await page.getByRole('button', { name: 'Меню', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Меню' });
  // F13: на Коллекции первая группа — «Коллекция» (Выбрать игры, Теги)
  await expect(sheet.locator('.ps-menu-group')).toHaveText(['Коллекция', 'Разделы', 'Данные', 'Помощь', 'Администрирование', 'Выход', 'Опасная зона']);
  const items = sheet.locator('.ps-menu-item');
  await expect(items.last()).toHaveText('Сбросить все статусы…');
  await expect(sheet.getByTestId('sheet-danger').getByTestId('menu-reset-all')).toBeVisible();
});

