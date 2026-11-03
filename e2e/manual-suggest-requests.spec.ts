// QA Фазы 43.1: расход запросов подсказок при наборе, устаревший клиентский кэш, снимки 7 тем (360 px), тап-зоны, CLS Бэклога.
import { test, expect, type Page } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { cand, mgame, mockManual } from './manual-mock';
import { signedSession } from './session';
import { shotsDir } from './shots';

const SHOTS = shotsDir('shots-43-1');

const bl = (id: number, title: string): G => ({ id, title, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null });
const tour = JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } });

async function boot(page: Page, context: import('@playwright/test').BrowserContext, baseURL: string, theme = 'night') {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.addInitScript((t) => { localStorage.setItem('ps-theme', t); localStorage.setItem('ps-bl-view', 'list'); localStorage.setItem('ps-wn-seen:1', '14'); }, theme);
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: tour }));
  await mockApi(page, [bl(1, 'Альфа Экшен'), bl(2, 'Браво Гонки')]);
}
const openField = async (page: Page) => {
  if (await page.getByTestId('bs-open').isVisible().catch(() => false)) await page.getByTestId('bs-open').click();
  const input = page.getByTestId('bs-input');
  await input.focus();
  return input;
};

test.describe('QA-43.1 расход запросов подсказок', () => {
  for (const [name, delay] of [['быстрый набор 120 мс/символ', 120], ['средний набор 280 мс/символ', 280], ['медленный набор 450 мс/символ', 450]] as const) {
    test(name, async ({ page, context, baseURL }, info) => {
      test.skip(info.project.name !== 'desktop', 'один проект');
      await boot(page, context, baseURL!);
      const m = await mockManual(page, { candidates: [cand('1', 'Horizon Zero Dawn')] });
      await page.goto('/backlog');
      await page.locator('.ps-blrow, .ps-card:not(.ps-card--sk)').first().waitFor();
      const input = await openField(page);
      await input.pressSequentially('horizon zero dawn', { delay });
      await page.waitForTimeout(700);
      console.log(`QA-REQS ${name}: ${m.suggestCalls.length} запросов за 17 символов: ${m.suggestCalls.join(' | ')}`);
      expect(m.suggestCalls.length).toBeGreaterThan(0);
    });
  }

  test('клиентский кэш без TTL и инвалидации: устаревший inBacklog после удаления записи', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'desktop', 'один проект');
    await boot(page, context, baseURL!);
    const m = await mockManual(page, { candidates: [cand('1', 'Hades II', { inBacklog: true })], items: [mgame(1, 'Hades II', { externalId: '1' })] });
    await page.goto('/backlog');
    await page.locator('.ps-blrow, .ps-card:not(.ps-card--sk)').first().waitFor();
    const input = await openField(page);
    await input.fill('hades');
    await expect(page.locator('[data-testid="bs-opt"][data-kind="store"]')).toHaveCount(1);
    // запись убирают через интерфейс («Убрать из бэклога»): кэш подсказок должен сброситься, сервер теперь отвечает inBacklog=false
    m.candidates = [cand('1', 'Hades II', { inBacklog: false })];
    await input.fill('');
    await page.keyboard.press('Escape');
    const toggle = page.getByTestId('bl-nb-toggle');
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    await page.getByRole('button', { name: 'Действия: Hades II' }).click();
    await page.getByTestId('np-menu-remove').click();
    await page.getByTestId('np-remove-confirm').click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    const input2 = await openField(page);
    await input2.fill('hades');
    await page.waitForTimeout(700);
    const st = await page.locator('[data-testid="bs-opt"][data-kind="store"]').first().getAttribute('data-state');
    console.log(`QA-STALE data-state=${st}, suggestCalls=${m.suggestCalls.length}`);
    expect(st).toBe('idle');
  });
});

for (const theme of ['night', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5', 'graphite']) {
  test(`QA-43.1 снимки ${theme}`, async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'mobile', 'один проект');
    await boot(page, context, baseURL!, theme);
    await mockManual(page, {
      items: [mgame(1, 'Очень длинное название игры, которое не помещается в одну строку списка'), mgame(2, 'Купленная', { notPurchased: false }), mgame(3, 'Третья')],
      candidates: [cand('11', 'Hades II'), cand('12', 'Hades Remix', { platforms: ['PlayStation 4'] }), cand('13', 'Hades Тест')],
      batchDup: ['12'],
    });
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/backlog');
    await page.locator('[data-manual]').first().waitFor();
    await page.screenshot({ path: `${SHOTS}/${theme}-list.png` });
    await page.getByTestId('bl-nb').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/${theme}-nb.png` });
    await page.getByTestId('bs-open').click();
    await page.getByTestId('bs-input').fill('hades');
    await page.locator('[data-testid="bs-opt"][data-kind="store"]').first().waitFor();
    await page.screenshot({ path: `${SHOTS}/${theme}-suggest.png` });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Поиск' }).waitFor({ state: 'hidden' });
    await page.getByTestId('bl-add').click();
    await page.getByTestId('add-input').fill('hades');
    await page.getByTestId('add-submit').click();
    await page.getByTestId('add-row').first().waitFor();
    await page.getByTestId('add-pick').nth(0).click();
    await page.getByTestId('add-pick').nth(1).click();
    await page.screenshot({ path: `${SHOTS}/${theme}-cart.png` });
    // тап-зоны
    const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.ps-add-row__pick, .ps-add-seg button, [role="radio"], .ps-cart button')].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { c: `${e.className.toString().slice(0, 24)}|${(e.textContent ?? '').trim().slice(0, 12)}|${e.parentElement?.className.toString().slice(0, 24)}`, w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 44 || x.h < 44));
    console.log(`QA-TAP ${theme}: ${JSON.stringify(small)}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
