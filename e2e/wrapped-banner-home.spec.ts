// П8.4: баннер «Итоги года готовы» на главной с 1 декабря (МСК), «предварительно» до конца года; ✕ помнится и для сервера (cookie).
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const THIS_YEAR = new Date(Date.now() + 3 * 3600_000).getUTCFullYear();

test.beforeEach(async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await mockApi(page);
});

test('30 ноября 23:50 МСК баннера нет, 1 декабря 00:10 МСК есть и «предварительно»', async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${THIS_YEAR}-11-30T20:50:00Z`));
  await page.goto('/');
  await expect(page.locator('.ps-card').first()).toBeVisible();
  await expect(page.getByTestId('wrapped-banner')).toHaveCount(0);

  await page.clock.setFixedTime(new Date(`${THIS_YEAR}-11-30T21:10:00Z`)); // по UTC ещё ноябрь
  await page.reload();
  const banner = page.getByTestId('wrapped-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(`Итоги ${THIS_YEAR} готовы`);
  await expect(banner.locator('.ps-wbanner__pre')).toHaveText('предварительно');
  await expect(banner.getByRole('link')).toHaveAttribute('href', `/wrapped?year=${THIS_YEAR}`);
  await expect(banner).toContainText('до 31 дек');
  // одна строка: первый экран с «Играю» не уезжает (на 360 px тоже)
  await page.setViewportSize({ width: 360, height: 640 });
  expect((await banner.boundingBox())!.height).toBeLessThanOrEqual(64);
  const x = (await banner.getByRole('button', { name: 'Скрыть' }).boundingBox())!;
  expect(Math.min(x.width, x.height)).toBeGreaterThanOrEqual(44);
});

test('✕ скрывает баннер, пишет cookie для сервера; после перезагрузки его нет', async ({ page, context }) => {
  await page.clock.setFixedTime(new Date(`${THIS_YEAR}-12-15T09:00:00Z`));
  await page.goto('/');
  const banner = page.getByTestId('wrapped-banner');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Скрыть' }).click();
  await expect(banner).toHaveCount(0);
  expect((await context.cookies()).find((c) => c.name === 'ps-wbh')?.value).toBe(String(THIS_YEAR));
  await page.reload();
  await expect(page.locator('.ps-card').first()).toBeVisible();
  await expect(page.getByTestId('wrapped-banner')).toHaveCount(0);
});

test('январь: итоги прошлого года без «предварительно»', async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${THIS_YEAR + 1}-01-10T09:00:00Z`));
  await page.goto('/');
  const banner = page.getByTestId('wrapped-banner');
  await expect(banner).toContainText(`Итоги ${THIS_YEAR} готовы`);
  await expect(banner.locator('.ps-wbanner__pre')).toHaveCount(0);
});

test('сервер рисует баннер сам, когда сезон идёт сейчас: в HTML он есть до гидрации (CLS 0)', async ({ page, request, baseURL }) => {
  const now = new Date(Date.now() + 3 * 3600_000);
  test.skip(now.getUTCMonth() !== 11 && now.getUTCMonth() !== 0, 'вне сезона сервер баннер не рисует');
  const html = await (await request.get(`${baseURL}/`, { headers: { cookie: `pst_session=${await signedSession()}` } })).text();
  expect(html).toContain('data-testid="wrapped-banner"');
  void page;
});

test('контраст баннера с «предварительно» во всех темах (axe)', async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${THIS_YEAR}-12-15T09:00:00Z`));
  await page.goto('/');
  await expect(page.getByTestId('wrapped-banner')).toBeVisible();
  await page.evaluate(createRequire(import.meta.url)('axe-core').source);
  for (const t of ['night', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5', 'graphite']) {
    await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
    await page.waitForTimeout(400); // переходы цвета кнопок после смены темы
    const v = await page.evaluate(async () => {
      const w = window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[]; failureSummary: string }[] }[] }> } };
      const r = await w.axe.run({ include: [['[data-testid="wrapped-banner"]']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
      return r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => `${n.target.join(' ')} ${n.failureSummary}`).join('; ')}`);
    });
    expect(v, t).toEqual([]);
  }
});
