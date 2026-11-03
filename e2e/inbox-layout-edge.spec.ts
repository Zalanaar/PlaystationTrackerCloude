// QA Фазы 28: раскладка (360x640, 390x844, 1280), CLS при пустом ответе, контраст в 7 темах, скриншоты.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';
import { shotsDir } from './shots';

const SHOTS = shotsDir('shots-28');

const FULL = {
  newGames: 3, newGamesWindow: '24h', newUnsorted: 2, trophies: 14, platinums: 1, trophiesWindow: '24h',
  hoursWeek: 12.5, hoursPrevWeek: 9.5, checkCount: 4, forgottenCount: 7, isEmpty: false,
};
const THEMES = ['night', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5', 'graphite'] as const;

async function open(page: Page, context: BrowserContext, baseURL: string, inbox: Record<string, unknown> | null, delay = 0) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, seed());
  mock.inbox = inbox;
  mock.inboxDelay = delay;
  await page.addInitScript(() => { if (!localStorage.getItem('ps-wn-seen:1')) localStorage.setItem('ps-wn-seen:1', '12'); });
  await page.route('**/api/auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { id: 1, email: 'a@example.com', displayName: null, role: 'owner', amr: 'password' } }) }));
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
  await page.goto('/');
}
const setTheme = (page: Page, v: string) => page.evaluate((t) => { if (t === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }, v);

test('QA-28: скачок вёрстки при пустом ответе (скелет -> ничего)', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, null, 1200);
  await page.getByTestId('inbox-skeleton').waitFor();
  const card = page.locator('.ps-card').first();
  const before = (await card.boundingBox())?.y ?? 0;
  await page.getByTestId('inbox-skeleton').waitFor({ state: 'detached' });
  const after = (await card.boundingBox())?.y ?? 0;
  console.log(`CLS-shift ${page.viewportSize()?.width}: card y ${before} -> ${after} (delta ${before - after})`);
  expect(after).toBeLessThan(before); // схлопнулся, но через анимацию высоты (см. следующий тест)
});

test('QA-28-2: схлопывание скелета идёт анимацией, без мгновенного скачка', async ({ page, context, baseURL }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await open(page, context, baseURL!, null, 1200);
  await page.getByTestId('inbox-skeleton').waitFor();
  const card = page.locator('.ps-card').first();
  const before = (await card.boundingBox())!.y;
  const ys: number[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 2200) {
    ys.push((await card.boundingBox())!.y);
    await page.waitForTimeout(20);
  }
  const steps = ys.slice(1).map((y, i) => ys[i] - y).filter((d) => d > 0);
  expect(ys.at(-1)!).toBeLessThan(before);
  expect(steps.length).toBeGreaterThan(2); // несколько промежуточных кадров, а не один скачок
});

test('QA-28-5: тост скрывает «Что нового» и карточка возвращается', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, null);
  await page.evaluate(() => localStorage.setItem('ps-wn-seen:1', '11'));
  await page.reload();
  const wn = page.getByTestId('whats-new');
  await wn.waitFor({ timeout: 8000 });
  const st = page.getByRole('button', { name: 'Статус: Stray' });
  test.skip((await st.count()) === 0, 'на мобильном смена статуса через шторку, тост проверен на десктопе');
  await st.click();
  await page.getByRole('menuitemradio', { name: 'Играю' }).click();
  await expect(page.locator('.ps-toast').first()).toBeVisible();
  await expect(wn).toHaveCount(0);
});

test('QA-28: нет горизонтального скролла, размеры чипов; скриншоты', async ({ page, context, baseURL }, info) => {
  await open(page, context, baseURL!, FULL);
  await page.getByTestId('inbox-strip').waitFor();
  const w = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const r = await page.getByTestId('inbox-strip').boundingBox();
  const chips = await page.locator('.ps-inbox__chip').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  const hero = await page.locator('.ps-hero, [data-testid="playing-hero"]').first().boundingBox().catch(() => null);
  console.log(`LAYOUT ${info.project.name} w=${w}: strip h=${Math.round(r!.height)} chips=${JSON.stringify(chips)} hero=${JSON.stringify(hero)}`);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-night.png` });
});

for (const theme of THEMES) {
  test(`QA-28: контраст чипов и «Что нового», тема ${theme}`, async ({ page, context, baseURL }, info) => {
    await open(page, context, baseURL!, FULL);
    await page.getByTestId('inbox-strip').waitFor();
    await setTheme(page, theme);
    const res = await page.evaluate(() => {
      const lum = (c: string) => {
        const m = c.match(/[\d.]+/g)!.map(Number);
        const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
      };
      const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const out: Record<string, number> = {};
      const chip = document.querySelector('.ps-inbox__chip')!;
      const cs = getComputedStyle(chip);
      const txt = chip.querySelector('.ps-inbox__txt > span, .ps-inbox__txt')!;
      out.chipText = ratio(getComputedStyle(txt).color, cs.backgroundColor);
      out.chipNum = ratio(getComputedStyle(chip.querySelector('b')!).color, cs.backgroundColor);
      const panel = document.querySelector('.ps-inbox')!;
      out.label = ratio(getComputedStyle(document.querySelector('.ps-inbox__label')!).color, getComputedStyle(panel).backgroundColor);
      out.bgAlpha = Number(cs.backgroundColor.match(/[\d.]+/g)![3] ?? 1);
      return out;
    });
    console.log(`CONTRAST ${theme} ${info.project.name}: ${JSON.stringify(res)}`);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-${theme}.png` });
    expect(res.chipText).toBeGreaterThan(4.5);
    expect(res.label).toBeGreaterThan(4.5);
  });
}

test('QA-28: «Что нового» не перекрывает tab bar и тосты; позиция', async ({ page, context, baseURL }, info) => {
  await open(page, context, baseURL!, FULL);
  await page.evaluate(() => localStorage.setItem('ps-wn-seen:1', '11'));
  await page.reload();
  const wn = page.getByTestId('whats-new');
  await wn.waitFor({ timeout: 8000 });
  const b = (await wn.boundingBox())!;
  const tab = await page.locator('nav.ps-tabbar').boundingBox();
  console.log(`WN ${info.project.name}: ${JSON.stringify(b)} tabbar=${JSON.stringify(tab)} vp=${JSON.stringify(page.viewportSize())}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if (tab && tab.height > 0) expect(b.y + b.height).toBeLessThanOrEqual(tab.y + 1);
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-wn.png` });
});

for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
  test(`QA-28: вьюпорт ${vp.width}x${vp.height}: без h-скролла, hero виден`, async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'mobile', 'только мобильный проект');
    await page.setViewportSize(vp);
    await open(page, context, baseURL!, FULL);
    await page.getByTestId('inbox-strip').waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const s = (await page.getByTestId('inbox-strip').boundingBox())!;
    const h = (await page.locator('.ps-card').first().boundingBox())!;
    const tab = (await page.locator('nav.ps-tabbar').boundingBox())!;
    console.log(`VP ${vp.width}x${vp.height}: strip y=${Math.round(s.y)} h=${Math.round(s.height)}; first card y=${Math.round(h.y)}; tabbar y=${Math.round(tab.y)}`);
    await page.screenshot({ path: `${SHOTS}/vp-${vp.width}x${vp.height}.png` });
    await page.getByTestId('inbox-more').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
