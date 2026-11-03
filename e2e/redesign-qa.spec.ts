// QA приёмка редизайна «A Полка + B Хроника»: большой набор (214 игр, обложки, битые/отсутствующие), метрики вёрстки.
// API эмулируется (collection-mock.ts). Скриншоты пишутся в каталог SHOTS_DIR, если он задан.
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mockApi, type G, type Mock } from './collection-mock';
import { signedSession } from './session';
import { setView } from './view';

const SHOTS = process.env.SHOTS_DIR;

const TITLES = [
  'Horizon Forbidden West', 'Ведьмак 3: Дикая Охота', 'The Last of Us Part II Remastered', 'Ghost of Tsushima Director’s Cut',
  'ACE COMBAT 7: SKIES UNKNOWN', 'Marvel’s Spider-Man: Miles Morales', 'Red Dead Redemption 2', 'Persona 5 Royal',
  'Hades', 'Stray', 'Death Stranding', 'It Takes Two', 'Bloodborne', 'Elden Ring', 'Cyberpunk 2077', 'Tetris Effect: Connected',
  'Assassin’s Creed Valhalla Ragnarök Edition', 'Dragon Quest XI S: Echoes of an Elusive Age – Definitive Edition',
];

function cover(i: number): string | null {
  if (i % 17 === 0) return null;
  if (i % 23 === 0) return '/cv/broken.png';
  return `/cv/${i}.svg`;
}

export function bigSeed(): G[] {
  const out: G[] = [];
  const iso = (y: number, m: number, d: number, h = 12) => new Date(Date.UTC(y, m - 1, d, h)).toISOString();
  for (let i = 1; i <= 214; i++) {
    const title = i <= TITLES.length ? TITLES[i - 1] : `${TITLES[i % TITLES.length]} ${i}`;
    let status: G['status'] = null;
    let when: string | null = iso(2026, 1 + (i % 10), 1 + (i % 27));
    let completedAt: string | null = null;
    let droppedAt: string | null = null;
    if (i <= 4) { status = 'playing'; when = iso(2026, 10, 20 + (i % 5)); }
    else if (i <= 40) { status = 'completed'; completedAt = i % 2 ? iso(2026, 10, 1 + (i % 25)) : iso(2026, 1 + (i % 10), 1 + (i % 27)); when = completedAt; }
    else if (i <= 60) { status = 'completed'; completedAt = iso(2025, 1 + (i % 12), 1 + (i % 27)); when = completedAt; }
    else if (i <= 70) { status = 'completed'; completedAt = iso(2024, 1 + (i % 12), 1 + (i % 27)); when = completedAt; }
    else if (i <= 74) { status = 'completed'; completedAt = null; when = null; }
    else if (i <= 90) { status = 'dropped'; droppedAt = iso(2026, 1 + (i % 10), 1 + (i % 27)); when = droppedAt; }
    else if (i <= 120) { status = 'backlog'; }
    else if (i <= 128) { status = 'shelved'; }
    else if (i === 129) { status = 'completed'; completedAt = '2025-12-31T21:30:00.000Z'; when = completedAt; }
    else if (i === 130) { status = 'dropped'; droppedAt = '2026-12-31T21:30:00.000Z'; when = droppedAt; }
    if (i > 200) when = null;
    out.push({
      id: i, title, status, lastPlayedAt: when, completedAt, droppedAt,
      playSeconds: i > 205 ? 0 : (i * 7919) % 400_000 + 600, playCount: i > 205 ? 0 : (i % 40) + 1, coverUrl: cover(i),
      trophies: i % 3 === 0 ? { earned: 30 + (i % 40), defined: 78, plat: i % 6 === 0 } : null,
    });
  }
  return out;
}

async function routeCovers(page: Page) {
  await page.route('**/cv/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('broken.png')) return route.fulfill({ status: 404, body: '' });
    const n = Number(u.pathname.match(/(\d+)\.svg/)?.[1] ?? 0);
    const light = n % 5 === 0;
    const hue = (n * 47) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light ? '#ffffff' : `hsl(${hue},55%,35%)`}"/><stop offset="1" stop-color="${light ? '#e9eef7' : `hsl(${(hue + 60) % 360},60%,15%)`}"/></linearGradient></defs><rect width="300" height="400" fill="url(#g)"/><text x="150" y="210" font-size="42" text-anchor="middle" fill="${light ? '#222' : '#fff'}" opacity=".7">${n}</text></svg>`;
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg });
  });
}

async function open(page: Page, context: BrowserContext, baseURL: string, url = '/', games = bigSeed()): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await routeCovers(page);
  const mock = await mockApi(page, games);
  await page.goto(url);
  return mock;
}

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function shot(page: Page, name: string, full = true) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
}
async function theme(page: Page, t: 'night' | 'graphite' | 'ps5') {
  await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
}
async function expandAll(page: Page) {
  const closed = page.locator('.ps-year__btn[aria-expanded="false"]');
  while (await closed.count()) await closed.first().click();
}

const VIEWPORTS = [
  { name: 'd1440', width: 1440, height: 900, mobile: false },
  { name: 'm390', width: 390, height: 844, mobile: true },
  { name: 'm440', width: 440, height: 900, mobile: true },
];

for (const vp of VIEWPORTS) {
  test.describe(`redesign ${vp.name}`, () => {
    test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'вьюпорт задан в тесте'); });
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.mobile, isMobile: vp.mobile });

    test('метрики и скриншоты коллекции', async ({ page, context, baseURL }) => {
      await open(page, context, baseURL!);
      // D-P1 (пакет 2): на мобильном итоги в строке профиля, StatLine скрыта
      if (vp.mobile) await expect(page.locator('.ps-statline')).toBeHidden();
      else await expect(page.locator('.ps-statline')).toBeVisible();
      await expect(page.locator('article.ps-card').first()).toBeVisible();
      await page.waitForTimeout(500);
      const base = await page.evaluate(() => ({ nodes: document.getElementsByTagName('*').length, cards: document.querySelectorAll('article.ps-card').length }));
      console.log(vp.name, 'initial', JSON.stringify(base), 'overflow', await noOverflow(page));
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);
      await shot(page, `${vp.name}-night-default`);
      await expandAll(page);
      await page.waitForTimeout(400);
      const all = await page.evaluate(() => ({ nodes: document.getElementsByTagName('*').length, cards: document.querySelectorAll('article.ps-card').length, imgs: document.querySelectorAll('img').length, lazy: document.querySelectorAll('img[loading=lazy]').length }));
      console.log(vp.name, 'expanded', JSON.stringify(all), 'overflow', await noOverflow(page));
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);
      await shot(page, `${vp.name}-night-expanded`);

      // метрики карточек
      const bad = await page.evaluate(() => {
        const out: string[] = [];
        const one = (el: Element | null, what: string, id: string) => {
          if (!el) return;
          const cs = getComputedStyle(el);
          const lh = parseFloat(cs.lineHeight) || 16;
          if (el.getBoundingClientRect().height > lh * 1.6) out.push(`${what} многострочный: ${id}`);
          if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis') out.push(`${what} переполнен: ${id}`);
        };
        document.querySelectorAll('article.ps-card').forEach((c) => {
          const id = c.querySelector('.ps-card__title')?.textContent ?? '?';
          const cover = c.querySelector('.ps-card__cover')!.getBoundingClientRect();
          one(c.querySelector('.ps-card__date'), 'дата', id);
          one(c.querySelector('.ps-card__meta'), 'часы', id);
          const g = c.querySelector('.ps-card__glyph')?.getBoundingClientRect();
          if (g && cover.width > 0 && !(g.right <= cover.right + 0.5 && g.top >= cover.top - 0.5 && g.left > cover.left + cover.width / 2)) out.push(`фигура не справа сверху: ${id}`);
          const p = c.querySelector('.ps-card__plat')?.getBoundingClientRect();
          if (p && !(p.left < cover.left + cover.width / 2 && p.top < cover.top + 40)) out.push(`платина не слева сверху: ${id}`);
          const d = c.querySelector('.ps-card__date')?.getBoundingClientRect();
          if (d && g && !(d.right <= g.left || d.bottom <= g.top || d.left >= g.right || d.top >= g.bottom)) out.push(`дата пересекается с фигурой: ${id}`);
          if (d && p && !(d.right <= p.left || d.bottom <= p.top || d.left >= p.right || d.top >= p.bottom)) out.push(`дата пересекается с платиной: ${id}`);
          if (c.querySelector('.ps-card__plat') && g && p && !(p.right <= g.left || p.bottom <= g.top)) out.push(`платина и фигура пересекаются: ${id}`);
        });
        return out;
      });
      console.log(vp.name, 'card issues', bad.length, bad.slice(0, 8).join(' | '));
      expect(bad).toEqual([]);
      const badge = await page.evaluate(() => document.body.innerText.includes('PS5') || document.body.innerText.includes('PS4'));
      expect(badge).toBe(false);

      // режимы
      await setView(page, 'Плотно');
      await page.waitForTimeout(300);
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);
      await shot(page, `${vp.name}-night-dense`);
      await setView(page, 'Список');
      await page.waitForTimeout(300);
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);
      await shot(page, `${vp.name}-night-list`);
      await setView(page, 'Крупно');

      for (const t of ['graphite', 'ps5'] as const) {
        await theme(page, t);
        await page.waitForTimeout(300);
        await page.evaluate(() => window.scrollTo(0, 0));
        await shot(page, `${vp.name}-${t}-expanded`);
        await shot(page, `${vp.name}-${t}-top`, false);
      }
    });

    test('Разбор и Бэклог: скриншоты и переполнение', async ({ page, context, baseURL }) => {
      await open(page, context, baseURL!, '/triage');
      await expect(page.locator('.ps-tri__pos')).toBeVisible();
      await page.waitForTimeout(400);
      await shot(page, `${vp.name}-triage`);
      // на десктопе длинное название в очереди даёт скролл (BUG-R2, отдельный test.fail в redesign-edge.spec.ts)
      if (vp.mobile) expect(await noOverflow(page)).toBeLessThanOrEqual(0);
      await page.goto('/backlog');
      await expect(page.locator('article.ps-card').first()).toBeVisible();
      await page.waitForTimeout(400);
      expect(await noOverflow(page)).toBeLessThanOrEqual(0);
      await shot(page, `${vp.name}-backlog`, false);
    });
  });
}

test.describe('кадры мобильной хроники', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'вьюпорт задан в тесте'); });
  for (const w of [390, 440]) {
    test(`кадры ${w}`, async ({ browser, baseURL }) => {
      test.skip(!SHOTS, 'нужен SHOTS_DIR');
      const context = await browser.newContext({ viewport: { width: w, height: 844 }, hasTouch: true, isMobile: true });
      const page = await context.newPage();
      await open(page, context, baseURL!);
      await expect(page.locator('article.ps-card').first()).toBeVisible();
      await page.waitForTimeout(500);
      const y = await page.locator('#y2026').evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
      await page.evaluate((t) => window.scrollTo(0, t - 20), y);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/crop${w}-chron.png` });
      await page.evaluate((t) => window.scrollTo(0, t + 700), y);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/crop${w}-chron2.png` });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${SHOTS}/crop${w}-top.png` });
      await page.evaluate(() => document.querySelector('#backlog')!.scrollIntoView());
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/crop${w}-backlog.png` });
      await setView(page, 'Плотно');
      await page.evaluate((t) => window.scrollTo(0, t - 20), y);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/crop${w}-dense.png` });
      await setView(page, 'Список');
      await page.evaluate((t) => window.scrollTo(0, t - 20), y);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/crop${w}-list.png` });
    });
  }
});
