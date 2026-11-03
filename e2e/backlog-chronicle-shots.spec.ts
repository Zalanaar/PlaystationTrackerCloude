// QA Фазы 22: снимки 7 тем (Бэклог липкая плашка, Отложено, Хроника «Сейчас», Разбор «Дальше») + метрики и граничные случаи.
// Без SHOTS_DIR пропускается. Запуск: SHOTS_DIR=... QA_PORT=3217 npx playwright test -c e2e/qa.config.ts backlog-chronicle-shots --project=desktop
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed, type G } from './collection-mock';
import { signedSession } from './session';

const SHOTS = process.env.SHOTS_DIR;
const THEMES = ['night', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5', 'graphite'] as const;
const VPS = [{ w: 1280, h: 800 }, { w: 390, h: 800 }, { w: 360, h: 740 }, { w: 320, h: 640 }];
const WHITE = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#fff"/></svg>';
test.skip(!SHOTS, 'нужен SHOTS_DIR');
test.beforeEach(({}, i) => { test.skip(i.project.name !== 'desktop'); });

const g = (id: number, title: string, o: Partial<G> = {}): G => ({
  id, title, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 600, playCount: 1, trophies: null,
  coverUrl: 'https://img.example/white.png', ...o,
});
const LONG = 'Очень длинное название игры Мегаполис Суперсверхдлиннослово Хроники Тёмного Рыцаря Расширенное издание режиссёрская версия';
const many = (): G[] => [
  ...Array.from({ length: 30 }, (_, i) => g(i + 1, i === 2 ? LONG : `Бэклог ${i + 1}`, { playSeconds: i === 4 ? 0 : 600 })),
  ...Array.from({ length: 4 }, (_, i) => g(100 + i, i === 1 ? LONG : `Отложена ${i + 1}`, { status: 'shelved', playSeconds: i === 0 ? 0 : 7200 })),
  g(200, 'Сервис 1', { status: 'service' }),
  g(300, 'Играю Раз', { status: 'playing', lastPlayedAt: '2026-10-30T10:00:00.000Z' }),
  g(301, 'Играю Два', { status: 'playing', lastPlayedAt: '2026-10-20T10:00:00.000Z' }),
  g(302, 'Пройдена', { status: 'completed', completedAt: '2026-10-10T10:00:00.000Z', lastPlayedAt: '2026-10-10T10:00:00.000Z' }),
];
const setTheme = (page: Page, t: string) => page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
async function open(page: Page, context: import('@playwright/test').BrowserContext, baseURL: string, list: G[], url: string, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, list);
  await page.route('https://img.example/white.png', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: WHITE }));
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
  await page.goto(url);
  await page.locator('.ps-card:not(.ps-card--sk), .ps-empty, .ps-queue').first().waitFor();
}
const hs = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const theme of THEMES) for (const vp of VPS) {
  test(`${theme} ${vp.w}`, async ({ page, context, baseURL }) => {
    test.setTimeout(90_000);
    const out: string[] = [];
    await open(page, context, baseURL!, many(), '/backlog', vp.w, vp.h);
    await setTheme(page, theme);
    out.push(`hscroll backlog=${await hs(page)}`);
    // прилипшее состояние: промотать так, чтобы белые обложки были под плашкой
    await page.getByTestId('bl-jump').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 500));
    await expect(page.getByTestId('bl-jump')).toHaveAttribute('data-stuck', 'true');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/backlog-stuck-${theme}-${vp.w}.png` });
    const m = await page.evaluate(() => {
      const n = document.querySelector('[data-testid="bl-jump"]') as HTMLElement; const r = n.getBoundingClientRect();
      const hd = (document.querySelector('header') as HTMLElement).getBoundingClientRect();
      // под плашкой должна быть сплошная заливка: смотрим, что в точках внутри плашки верхний элемент — сама плашка или её дети
      const pts = [0.02, 0.5, 0.98].flatMap((fx) => [2, r.height / 2, r.height - 2].map((dy) => document.elementFromPoint(r.left + r.width * fx, r.top + dy)));
      const leaks = pts.filter((e) => e && !n.contains(e)).length;
      const cs = getComputedStyle(n);
      const tab = getComputedStyle(document.querySelector('.ps-bl-jump__tab') as HTMLElement);
      return { top: r.top, h: r.height, headerBottom: hd.bottom, leaks, bg: cs.backgroundColor, shadow: cs.boxShadow, tabBorder: tab.borderTopWidth };
    });
    out.push(`stuck ${JSON.stringify(m)}`);
    expect(m.leaks).toBe(0);
    expect(m.top).toBeLessThanOrEqual(m.headerBottom + 0.5);
    await page.locator('#h-bl-shelved').scrollIntoViewIfNeeded();
    await page.getByTestId('bl-jump').getByRole('button', { name: /^Отложено/ }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/shelved-${theme}-${vp.w}.png` });
    // перекрытие заголовка плашкой
    const ov = await page.evaluate(() => { const a = document.querySelector('#h-bl-shelved')!.getBoundingClientRect().top; const b = document.querySelector('[data-testid="bl-jump"]')!.getBoundingClientRect().bottom; return { headTop: a, jumpBottom: b }; });
    out.push(`shelved jump ${JSON.stringify(ov)}`);
    expect(ov.headTop).toBeGreaterThanOrEqual(ov.jumpBottom - 1);
    out.push(`hscroll after=${await hs(page)}`);
    await open(page, context, baseURL!, many(), '/', vp.w, vp.h);
    await setTheme(page, theme);
    await page.waitForTimeout(300);
    await page.getByTestId('now-block').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/chronicle-now-${theme}-${vp.w}.png` });
    out.push(`hscroll chronicle=${await hs(page)}`);
    console.log(`METRICS ${theme}/${vp.w}: ${out.join(' | ')}`);
  });
}

test('Разбор «Дальше»: плейсхолдер без обложки, 1280 и 390', async ({ page, context, baseURL }) => {
  const list = seed().map((x) => ({ ...x, coverUrl: null }));
  await open(page, context, baseURL!, list, '/triage', 1280, 800);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/triage-queue-night-1280.png` });
  await page.getByRole('complementary', { name: 'Дальше' }).screenshot({ path: `${SHOTS}/triage-queue-crop-1280.png` });
  console.log('QUEUE spans', JSON.stringify(await page.locator('.ps-queue__th.ps-cover--empty').evaluateAll((els) => els.map((e) => ({ t: e.textContent, w: e.getBoundingClientRect().width, sw: e.scrollWidth, ch: (e as HTMLElement).clientWidth })))));
});

test('шапка 320: статус синка текстом, не вылезает', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, many(), '/backlog', 320, 640);
  const r = await page.evaluate(() => { const b = document.querySelector('.ps-btn--sync')!.getBoundingClientRect(); const t = document.querySelector('.ps-sync-text-m') as HTMLElement; const hdr = document.querySelector('.ps-header__in')!; const kids = [...hdr.querySelectorAll('button,a')].map((e) => { const q = e.getBoundingClientRect(); return `${(e.getAttribute('aria-label') || e.textContent || '').slice(0, 14)}:${Math.round(q.left)}-${Math.round(q.right)}`; }); return { sync: [b.left, b.right], txt: t.textContent, clipped: t.scrollWidth > t.clientWidth, vw: innerWidth, kids }; });
  console.log('HEADER320', JSON.stringify(r));
  await page.screenshot({ path: `${SHOTS}/header-320.png`, clip: { x: 0, y: 0, width: 320, height: 120 } });
  expect(r.sync[1]).toBeLessThanOrEqual(320);
});

test('граничные: 0 playing, 0 shelved, перенос последней отложенной, тур', async ({ page, context, baseURL }) => {
  test.setTimeout(150_000);
  await open(page, context, baseURL!, many().filter((x) => x.status !== 'playing'), '/', 1280, 800);
  expect(await page.getByTestId('now-block').count()).toBe(0);
  await open(page, context, baseURL!, [g(1, 'Б1'), g(2, 'Б2'), g(100, 'Единственная', { status: 'shelved', playSeconds: 0 })], '/backlog', 360, 740);
  await page.getByTestId('bl-shelved').getByRole('button', { name: 'Вернуть в бэклог' }).click();
  await page.screenshot({ path: `${SHOTS}/last-shelved-moved-360.png` });
  console.log('LASTMOVED tab=', await page.getByTestId('bl-jump').innerText().catch(() => 'нет плашки'), '| shelved empty=', await page.getByTestId('bl-shelved').innerText());
  // 0 shelved, есть сервис: плашка из 2 вкладок
  await open(page, context, baseURL!, [g(1, 'Б1'), g(200, 'С1', { status: 'service' })], '/backlog', 360, 740);
  console.log('NOSHELVED jump=', await page.getByTestId('bl-jump').innerText().catch(() => 'нет плашки'), 'shelvedBlocks=', await page.getByTestId('bl-shelved').count());
  // тур
  for (const w of [1280, 360]) {
    await page.keyboard.press('Escape'); await page.goto('about:blank');
    await open(page, context, baseURL!, many(), '/', w, 800);
    if (w < 768) { await page.getByRole('button', { name: 'Меню', exact: true }).click(); await page.getByRole('button', { name: 'Как пользоваться' }).click(); }
    else { await page.locator('.ps-avatar').click(); await page.getByRole('menuitem', { name: 'Как пользоваться' }).click(); }
    for (let i = 0; i < 14; i++) { if (await page.locator('.ps-tour__pop h2, .ps-tour__pop h3').filter({ hasText: /^Бэклог$/ }).count()) break; await page.getByRole('dialog').getByRole('button', { name: 'Далее' }).click({ timeout: 5000 }); await page.waitForTimeout(300); }
    await page.waitForTimeout(1200);
    const info = await page.evaluate(() => { const s = document.querySelector('.ps-tour__spot')?.getBoundingClientRect(); const p = document.querySelector('.ps-tour__pop')!.getBoundingClientRect(); const j = document.querySelector('[data-testid="bl-jump"]')?.getBoundingClientRect(); return { spot: s && [s.left, s.top, s.width, s.height].map(Math.round), pop: [p.left, p.top, p.width, p.height].map(Math.round), jump: j && [j.top, j.bottom].map(Math.round), url: location.pathname, vh: innerHeight }; });
    console.log(`TOUR ${w}`, JSON.stringify(info));
    await page.screenshot({ path: `${SHOTS}/tour-backlog-${w}.png` });
  }
});
