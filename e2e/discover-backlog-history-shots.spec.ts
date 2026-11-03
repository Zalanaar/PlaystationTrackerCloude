// QA Фаз 30-34: снимки «У тебя нет», мобильного Бэклога («Список», sheet, меню «…»), окна игры с «Историей» в 7 темах. Без SHOTS_DIR пропускается.
// Запуск: SHOTS_DIR=docs/qa/phase-30-34 PW_CHROMIUM_PATH=/usr/bin/google-chrome QA_PORT=3342 npx playwright test -c e2e/qa.config.ts e2e/discover-backlog-history-shots.spec.ts --project=desktop
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { signedSession } from './session';

const SHOTS = process.env.SHOTS_DIR;
test.skip(!SHOTS, 'нужен SHOTS_DIR');
const THEMES = ['night', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5', 'graphite'] as const;
const setTheme = (page: Page, v: string) => page.evaluate((t) => { if (t === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }, v);
const tourStub = JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } });
const noH = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const item = (id: number, title: string, o: Record<string, unknown> = {}) => ({
  externalSource: 'rawg', externalId: String(id), title, releaseDate: '2019-05-05', coverUrl: null, platforms: ['PS5', 'PS4'], genres: ['ACTION', 'ROLE_PLAYING_GAMES'],
  rating: 4.3, metacritic: 91, rawgUrl: `https://rawg.io/games/g${id}`, reason: { text: `Похожа на «Хейдес» и «Элден Ринг», жанр «Экшен».`, source: 'template' }, planned: false, plannedId: null, ...o,
});

async function openDiscover(page: Page, context: BrowserContext, baseURL: string, meta: Record<string, unknown> = {}) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, []);
  const ok = (r: Route, data: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: tourStub }));
  await page.route(/\/api\/recommend$/, (r) => ok(r, { items: [], meta: { llm: 'disabled', candidates: 0, time: 'any', llmPending: 0 } }));
  await page.route(/\/api\/recommend\/dislikes$/, (r) => ok(r, { items: [], ttlDays: 30 }));
  await page.route(/\/api\/recommend\/discover$/, (r) => ok(r, {
    items: [item(1, 'Nioh 2: The Complete Edition with a very long title to test wrapping', { coverUrl: 'https://media.rawg.io/x.jpg' }), item(2, 'Bloodborne', { planned: true, plannedId: 3, genres: [], rating: null }), item(3, 'Sekiro', { reason: { text: 'Фраза от ИИ про Sekiro.', source: 'llm' }, platforms: ['PS4'] })],
    meta: { catalog: 'ok', generatedAt: '2026-10-31T05:00:00.000Z', stale: false, partial: false, reason: null, total: 3, limit: 12, ...meta },
  }));
  await page.goto('/recommend?tab=discover');
  await page.getByTestId('discover-card').first().waitFor();
}

for (const theme of THEMES) {
  test(`discover ${theme}`, async ({ page, context, baseURL }) => {
    for (const [w, h, tag] of [[1280, 800, 'desktop'], [375, 740, 'm375']] as const) {
      await page.setViewportSize({ width: w, height: h });
      await openDiscover(page, context, baseURL as string, w === 375 ? { stale: true, partial: true } : {});
      await setTheme(page, theme);
      expect(await noH(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOTS}/discover-${tag}-${theme}.png` });
    }
  });
}

const bl = (id: number, title: string, o: Partial<G> = {}): G => ({ id, title, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null, ...o });
const blGames = (): G[] => [
  bl(1, 'Альфа Экшен', { genres: ['ACTION'], hltbHours: 8, hltbName: 'Alpha', hltbChecked: true }),
  bl(2, 'Браво Хоррор с очень длинным названием для проверки обрезки строки в списке', { genres: ['HORROR'], hltbHours: 12.4, hltbName: 'Bravo', hltbChecked: true }),
  bl(3, 'Чарли Нет на HLTB', { hltbChecked: true }), bl(4, 'Дельта Не проверена'), bl(5, 'Эхо Ручная', { override: 25, hltbChecked: true }),
  bl(6, 'Фокстрот', { hltbHours: 3, hltbChecked: true }), bl(7, 'Гольф', { hltbHours: 30, hltbChecked: true }),
];

for (const theme of THEMES) {
  test(`backlog ${theme}`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL as string }]);
    await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: tourStub }));
    await mockApi(page, blGames());
    for (const [w, h] of [[360, 640], [320, 568]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/backlog');
      await page.locator('.ps-blrow').first().waitFor();
      await setTheme(page, theme);
      expect(await noH(page)).toBeLessThanOrEqual(0);
      const first = await page.locator('.ps-blrow').first().boundingBox();
      const tab = await page.locator('.ps-tabbar').boundingBox();
      expect(first!.y + first!.height).toBeLessThanOrEqual(tab!.y + 0.5);
      await page.screenshot({ path: `${SHOTS}/backlog-${w}-${theme}.png` });
      if (w === 360) {
        // меню «…» в нижней видимой строке
        const btns = page.locator('.ps-blrow').getByRole('button', { name: /^Действия:/ });
        const n = await btns.count();
        const lastVisible = await btns.evaluateAll((els, tabY) => els.map((e, i) => ({ i, y: e.getBoundingClientRect().bottom })).filter((x) => x.y <= (tabY as number)).pop()?.i ?? 0, tab!.y);
        await btns.nth(Math.min(lastVisible, n - 1)).click();
        const menu = page.getByRole('menu').first();
        await expect(menu).toBeVisible();
        await page.waitForTimeout(600);
        const mb = await menu.boundingBox();
        const overlapsNav = mb!.y + mb!.height > tab!.y + 0.5;
        await page.screenshot({ path: `${SHOTS}/backlog-menu-${w}-${theme}${overlapsNav ? '-OVERLAP' : ''}.png` });
        test.info().annotations.push({ type: `menu-overlap-${theme}`, description: String(overlapsNav) });
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: /^Фильтры и сортировка/ }).click();
        await page.getByRole('dialog', { name: 'Фильтры и сортировка' }).waitFor();
        await page.screenshot({ path: `${SHOTS}/backlog-sheet-${w}-${theme}.png` });
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Ещё: действия со страницей' }).click();
        await page.getByRole('menu').first().waitFor();
        await page.waitForTimeout(600); // анимация появления меню
        await page.screenshot({ path: `${SHOTS}/backlog-pagemenu-${w}-${theme}.png` });
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/backlog');
    await page.locator('.ps-card:not(.ps-card--sk), .ps-blrow').first().waitFor();
    await setTheme(page, theme);
    await page.screenshot({ path: `${SHOTS}/backlog-desktop-${theme}.png` });
  });
}

const week = (weekStart: string, seconds = 0, estimatedSeconds = 0, trophies = 0, platinum = false) => ({ weekStart, seconds, estimatedSeconds, trophies, platinum });
const hist = { weeks: [week('2026-05-04', 7200, 3600), week('2026-05-11', 3600, 1800), week('2026-05-18', 10_800), week('2026-05-25'), week('2026-06-01', 1800, 0, 2, true)], truncated: false, hasHours: true, hasEstimate: true, playedDays: 14, firstSnapshotDate: '2026-05-12' };
for (const theme of THEMES) {
  test(`game window ${theme}`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL as string }]);
    for (const [w, h, tag] of [[1280, 900, 'desktop'], [375, 740, 'm375']] as const) {
      await page.setViewportSize({ width: w, height: h });
      const mock = await mockApi(page, [{ id: 1, title: 'Stray', lastPlayedAt: '2026-06-06T10:00:00.000Z', status: 'playing', completedAt: null, droppedAt: null, playSeconds: 36_000, playCount: 5, trophies: null }]);
      mock.histories[1] = hist;
      await page.goto('/?game=1');
      await page.getByTestId('game-history').waitFor();
      await setTheme(page, theme);
      expect(await noH(page)).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOTS}/window-${tag}-${theme}.png` });
    }
  });
}
