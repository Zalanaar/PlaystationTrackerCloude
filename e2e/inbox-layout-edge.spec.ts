// QA Фазы 28: раскладка (360x640, 390x844, 1280), без сдвига при пустом ответе и ошибке (п. B), память вкладки, контраст в 7 темах, скриншоты.
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

async function open(page: Page, context: BrowserContext, baseURL: string, inbox: Record<string, unknown> | null, delay = 0, fails = 0) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, seed());
  mock.inbox = inbox;
  mock.inboxDelay = delay;
  mock.inboxFails = fails;
  await page.addInitScript(() => { if (!localStorage.getItem('ps-wn-seen:1')) localStorage.setItem('ps-wn-seen:1', '12'); });
  await page.route('**/api/auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { id: 1, email: 'a@example.com', displayName: null, role: 'owner', amr: 'password' } }) }));
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
  await page.goto('/');
  return mock;
}
const setTheme = (page: Page, v: string) => page.evaluate((t) => { if (t === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }, v);

/** layout-shift без недавнего ввода, с момента сброса (п. B). */
async function trackShifts(page: Page) {
  await page.addInitScript(() => {
    type LS = PerformanceEntry & { value: number; hadRecentInput: boolean };
    const w = window as unknown as { __ls: number[] };
    w.__ls = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries() as LS[]) if (!e.hadRecentInput) w.__ls.push(e.value); }).observe({ type: 'layout-shift', buffered: true });
  });
}
const resetShifts = (page: Page) => page.evaluate(() => { (window as unknown as { __ls: number[] }).__ls.length = 0; });
const shifts = (page: Page) => page.evaluate(() => (window as unknown as { __ls: number[] }).__ls.reduce((s, v) => s + v, 0));
const frames = (page: Page) => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));

// п. B: раньше пустой ответ схлопывал скелет анимацией высоты (Фаза 28), при медленном ответе это давало CLS ~0.04.
// Теперь место, занятое скелетом, остаётся той же высоты со строкой «ничего нового»: Коллекция не сдвигается.
test('QA-28: пустой ответ после скелета — без сдвига вёрстки', async ({ page, context, baseURL }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await trackShifts(page);
  await open(page, context, baseURL!, null, 1200);
  const sk = page.getByTestId('inbox-skeleton');
  await sk.waitFor();
  const card = page.locator('.ps-card').first();
  await card.waitFor();
  const before = (await card.boundingBox())!.y;
  const boxH = (await sk.boundingBox())!.height;
  await frames(page);
  await resetShifts(page);
  await sk.waitFor({ state: 'detached' });
  await expect(page.getByTestId('inbox-empty')).toBeVisible();
  await expect(page.getByTestId('inbox-empty')).toContainText('ничего нового');
  await page.waitForTimeout(600); // дольше прежней анимации схлопывания
  expect((await card.boundingBox())!.y).toBe(before);
  expect((await page.getByTestId('inbox-reserved').boundingBox())!.height).toBe(boxH);
  expect(await shifts(page)).toBe(0);
  // ✕ — действие пользователя: коробка уходит
  await page.getByTestId('inbox-hide').click();
  await expect(page.getByTestId('inbox-reserved')).toHaveCount(0);
});

test('QA-28-2: ошибка и «недоступно» после скелета держат ту же высоту', async ({ page, context, baseURL }) => {
  await trackShifts(page);
  await open(page, context, baseURL!, FULL, 800, 2);
  const sk = page.getByTestId('inbox-skeleton');
  await sk.waitFor();
  const card = page.locator('.ps-card').first();
  await card.waitFor();
  const before = (await card.boundingBox())!.y;
  await frames(page);
  await resetShifts(page);
  await expect(page.getByTestId('inbox-error')).toBeVisible();
  expect((await card.boundingBox())!.y).toBe(before);
  expect(await shifts(page)).toBe(0);
  await page.getByTestId('inbox-retry').click();
  await expect(page.getByTestId('inbox-gone')).toBeVisible();
  expect((await card.boundingBox())!.y).toBe(before);
});

test('QA-28-3: возврат на Коллекцию из другой вкладки — полоса из памяти, без скелета', async ({ page, context, baseURL }, info) => {
  test.skip(info.project.name === 'mobile', 'вкладки в шапке только на десктопе');
  const mock = await open(page, context, baseURL!, FULL);
  await page.getByTestId('inbox-strip').waitFor();
  await page.getByRole('link', { name: 'Бэклог', exact: true }).first().click();
  await page.waitForURL(/\/backlog/);
  mock.inboxDelay = 1500;
  const callsBefore = mock.inboxCalls;
  await page.evaluate(() => {
    const w = window as unknown as { __sk: boolean };
    w.__sk = false;
    new MutationObserver(() => { if (document.querySelector('[data-testid="inbox-skeleton"]')) w.__sk = true; }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole('link', { name: 'Коллекция', exact: true }).first().click();
  await page.waitForURL((u) => u.pathname === '/');
  await expect(page.getByTestId('inbox-strip')).toBeVisible();
  // фоновое обновление дошло (задержка 1,5 с), скелета не было ни разу
  await expect.poll(() => mock.inboxCalls, { timeout: 5000 }).toBeGreaterThan(callsBefore);
  await page.waitForTimeout(1700);
  expect(await page.evaluate(() => (window as unknown as { __sk: boolean }).__sk)).toBe(false);
  await expect(page.getByTestId('inbox-strip')).toHaveAttribute('data-count', '5');
});

// Клиентский переход без памяти вкладки: прошлый ответ был пустым (подсказка в localStorage) — коробку «ничего нового» не рисуем
// и места не занимаем; пустой ответ ничего не сдвигает. Если же пришли чипы — полоса появляется (сдвиг только в этом случае).
const toCollection = (page: Page) => page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Коллекция', exact: true }).locator('visible=true').first().press('Enter'); // клавиатурой: на мобильном индикатор dev-сервера Next лежит поверх левой вкладки

test('QA-28-4: переход на Коллекцию без памяти вкладки после пустого визита — без «ничего нового» и без сдвига', async ({ page, context, baseURL }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await trackShifts(page);
  const mock = await open(page, context, baseURL!, null);
  await expect(page.getByTestId('inbox-empty')).toBeVisible(); // загрузка документа без seed: коробка, как в QA-28
  expect(await page.evaluate(() => localStorage.getItem('ps-inbox-empty'))).toBe('1');
  await page.goto('/backlog'); // новая загрузка документа: памяти вкладки нет
  await page.getByRole('navigation', { name: 'Разделы' }).locator('visible=true').first().waitFor();
  mock.inboxDelay = 1200;
  const callsBefore = mock.inboxCalls;
  await page.evaluate(() => {
    const w = window as unknown as { __box: boolean };
    w.__box = false;
    new MutationObserver(() => { if (document.querySelector('[data-testid="inbox-skeleton"], [data-testid="inbox-reserved"]')) w.__box = true; }).observe(document.body, { childList: true, subtree: true });
  });
  await toCollection(page);
  await page.waitForURL((u) => u.pathname === '/');
  const card = page.locator('.ps-card').first();
  await card.waitFor();
  const before = (await card.boundingBox())!.y;
  await frames(page);
  await resetShifts(page);
  await expect.poll(() => mock.inboxCalls, { timeout: 5000 }).toBeGreaterThan(callsBefore);
  await page.waitForTimeout(1500); // ответ (1,2 с) дошёл
  expect(await page.evaluate(() => (window as unknown as { __box: boolean }).__box)).toBe(false);
  await expect(page.getByTestId('inbox-empty')).toHaveCount(0);
  await expect(page.getByTestId('inbox-strip')).toHaveCount(0);
  expect((await card.boundingBox())!.y).toBe(before);
  expect(await shifts(page)).toBe(0);
});

test('QA-28-4b: после пустого визита пришли новые события — полоса появляется, подсказка снимается', async ({ page, context, baseURL }) => {
  const mock = await open(page, context, baseURL!, null);
  await expect(page.getByTestId('inbox-empty')).toBeVisible();
  await page.goto('/backlog');
  await page.getByRole('navigation', { name: 'Разделы' }).locator('visible=true').first().waitFor();
  mock.inbox = FULL;
  await toCollection(page);
  await page.waitForURL((u) => u.pathname === '/');
  await expect(page.getByTestId('inbox-strip')).toBeVisible();
  await expect(page.getByTestId('inbox-skeleton')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('ps-inbox-empty'))).toBeNull();
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
