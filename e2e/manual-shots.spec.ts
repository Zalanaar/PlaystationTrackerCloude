// QA Фазы 43: снимки Бэклога с «не куплено», панели поиска (с предупреждением о дубле) и листа «Это та игра?» в 7 темах, 360 px.
import { test, expect } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { cand, mgame, mockManual, type MMatch } from './manual-mock';
import { signedSession } from './session';
import { shotsDir } from './shots';
import { addBtn } from './header-actions';

const SHOTS = shotsDir('shots-43');

const THEMES = ['night', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5', 'graphite'];
const bl = (id: number, title: string): G => ({ id, title, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null });
const match: MMatch = { id: 1, title: 'Hades', coverUrl: null, notPurchased: true, game: { gameId: 9, name: 'Hades II', imageUrl: null, lastPlayedAt: '2026-10-30T10:00:00.000Z', hours: 2 } };

for (const theme of THEMES) {
  test(`снимки ${theme}`, async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'mobile', 'один проект');
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    await page.addInitScript((t) => { localStorage.setItem('ps-theme', t); localStorage.setItem('ps-bl-view', 'list'); localStorage.setItem('ps-wn-seen:1', '14'); }, theme);
    await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
    await mockApi(page, [bl(1, 'Альфа Экшен'), bl(2, 'Браво Гонки')]);
    await mockManual(page, {
      items: [mgame(1, 'Очень длинное название игры, которое не помещается в одну строку списка'), mgame(2, 'Купленная', { notPurchased: false })],
      matches: [match],
      batchDup: ['1'],
      candidates: [cand('1', 'Hades II', { duplicate: 'library' }), cand('2', 'Hades')],
    });
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/backlog');
    await page.locator('[data-manual]').first().waitFor();
    const t = await page.evaluate(() => document.documentElement.dataset.theme ?? '');
    await page.screenshot({ path: `${SHOTS}/${theme}-list.png` });
    await page.getByTestId('inbox-match').click();
    await page.getByTestId('match-card').first().waitFor();
    await page.screenshot({ path: `${SHOTS}/${theme}-match.png` });
    await page.getByTestId('match-close').click();
    await addBtn(page).click();
    await page.getByTestId('add-input').fill('hades');
    await page.getByTestId('add-submit').click();
    await page.getByTestId('add-row').first().waitFor();
    await page.getByTestId('add-pick').first().click();
    await page.getByTestId('add-cart-submit').click();
    await page.getByTestId('add-warn').waitFor();
    await page.screenshot({ path: `${SHOTS}/${theme}-add.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), t).toBe(true);
  });
}
