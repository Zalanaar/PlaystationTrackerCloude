// QA Фаз 9.1/14/15: полностраничные снимки во всех 7 темах (SHOTS_DIR) + автопроверки темы без SHOTS_DIR:
// нет горизонтальной прокрутки, нет явного «тёмного на тёмном / светлого на светлом» по ближайшему сплошному фону.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const SHOTS = process.env.SHOTS_DIR;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'] as const;
const Y = new Date(Date.now() + 3 * 3600_000).getUTCFullYear();
const z = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };
const setTheme = (page: Page, t: string) =>
  page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
const short = (id: number, title: string) => ({ id, title, coverUrl: null });
const g = (id: number, title: string, status: string | null = 'playing') => ({
  id, title, coverUrl: null, bannerUrl: null, tint: null, hiddenAt: null, platform: 'PS5', playSeconds: 36000, hours: 10, playCount: 3,
  lastPlayedAt: `${Y}-03-10T10:00:00.000Z`, status, completedAt: null, droppedAt: null, trophies: null, genres: [{ key: 'ACTION', label: 'Экшен' }],
});
const item = (id: number, title: string, real: number, est: number) => ({ gameId: id, hours: real + est, hoursReal: real, hoursEstimated: est, estimated: est > 0, finished: null, finishedAt: null });
const rare = (n: number, o: Record<string, unknown> = {}) => ({
  setId: 1, trophyId: n, type: 'gold', name: `Редкий трофей ${n}`, detail: 'Описание', iconUrl: null, earnedAt: `${Y}-03-02T19:10:00.000Z`,
  earnedRate: 0.8 + n, rarity: 0, setName: 'Horizon', game: short(17, 'Horizon Forbidden West'), ...o,
});

function stats(u: URL) {
  const year = Number(u.searchParams.get('year') ?? Y);
  return {
    period: { type: 'year', year, month: null, from: `${year}-01-01`, to: `${year}-12-31`, fromUtc: `${year - 1}-12-31T21:00:00.000Z`, toUtc: `${year}-12-31T21:00:00.000Z` },
    years: [Y], header: { completed: 3, dropped: 1, hours: 120, platinum: 1 },
    hours: { byMonth: Array(12).fill(null).map((_, i) => (i < 6 ? 10 + i * 7 : null)), estimatedByMonth: Array(12).fill(0).map((_, i) => (i === 2 ? 6 : 0)), estimatedHours: 6, hasEstimate: true, firstSnapshotDate: `${Y}-01-15`, periodPartial: false },
    genres: { hasData: true, items: [{ key: 'ACTION', label: 'Экшен', value: 3, gameIds: [1] }, { key: 'RPG', label: 'Ролевые', value: 2, gameIds: [2] }, { key: 'OTHER', label: 'Другое', value: 1, gameIds: [3] }], games: { 1: short(1, 'Игра Один'), 2: short(2, 'Игра Два'), 3: short(3, 'Игра Три') } },
    top: { byHours: [{ game: g(1, 'Игра Один'), hours: 42.5, estimated: false }, { game: g(2, 'Игра Два'), hours: 21, estimated: true }], byTrophies: [] },
    rareTrophies: { period: [rare(0), rare(1, { type: 'platinum' }), rare(2, { type: 'bronze', game: null, setName: 'Старая игра' })], allTime: [rare(9, { earnedRate: 0.1 })] },
    trophies: { counts: { platinum: 1, gold: 4, silver: 6, bronze: 20, total: 31 }, byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...z, total: i < 6 ? 5 : 0, bronze: i < 6 ? 5 : 0 })) },
    finished: { groups: [] },
    played: { games: Object.fromEntries([[21, 'Ghost of Tsushima'], [22, 'Hades Two'], [24, 'Single Month']].map(([i, t]) => [String(i), g(i as number, t as string)])), groups: [{ month: `${year}-03`, year, monthNumber: 3, completed: 1, dropped: 0, items: [item(21, 'Ghost of Tsushima', 0, 4), item(22, 'Hades Two', 5, 0)], excluded: [{ ...item(24, 'Single Month', 2, 0), estimated: false }] }] },
  };
}

async function boot(page: Page, context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page);
  await page.route(/\/api\/stats\?/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: stats(new URL(r.request().url())) }) }));
  return mock;
}

/** Ближайший непрозрачный фон и цвет текста: ищет пары с контрастом < 2 (грубо, градиенты и картинки пропускает). */
async function lowContrast(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const parse = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
    const lum = (c: { r: number; g: number; b: number }) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !n.textContent?.trim()) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.3) continue;
      const fg = parse(cs.color);
      if (!fg) continue;
      let bg: { r: number; g: number; b: number } | null = null;
      let skip = false;
      for (let a: Element | null = el; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.backgroundImage !== 'none') { skip = true; break; }
        const b = parse(s.backgroundColor);
        if (b && b.a >= 0.95) { bg = b; break; }
      }
      if (skip || !bg) continue;
      const L1 = lum(fg), L2 = lum(bg);
      const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      if (cr < 2) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} "${n.textContent.trim().slice(0, 30)}" cr=${cr.toFixed(2)}`);
    }
    return out;
  });
}

const PAGES = ['/', '/stats', '/triage', '/backlog'] as const;

for (const t of THEMES) {
  test(`тема ${t}: страницы без горизонтальной прокрутки и без нечитаемого текста`, async ({ page, context, baseURL }, info) => {
    test.setTimeout(120_000);
    await boot(page, context, baseURL!);
    for (const path of PAGES) {
      await page.goto(path);
      await page.waitForTimeout(400);
      await setTheme(page, t);
      await page.waitForTimeout(300);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${path} ${t}: горизонтальная прокрутка`).toBeLessThanOrEqual(0);
      const bad = await lowContrast(page);
      test.info().annotations.push({ type: `contrast ${path}`, description: bad.slice(0, 8).join(' | ') || 'ok' });
      expect(bad, `${path} ${t}: контраст < 2`).toEqual([]);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/full-${info.project.name}-${t}-${path.replace(/\//g, '_') || 'root'}.png`, fullPage: true });
    }
  });
}

test('декор: при reduced-motion нет бесконечных анимаций (PS2–PS5)', async ({ page, context, baseURL }, info) => {
  await boot(page, context, baseURL!);
  await page.goto('/');
  await setTheme(page, 'ps4');
  await page.waitForTimeout(300);
  const anim = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll('body, body *, html')) for (const pe of [null, '::before', '::after']) {
      const s = getComputedStyle(el, pe);
      if (s.animationName !== 'none' && s.display !== 'none' && Number(s.opacity) > 0) out.push(`${el.tagName}.${String(el.className).slice(0, 30)}${pe ?? ''}:${s.animationName}`);
    }
    return out;
  });
  info.annotations.push({ type: 'ps4 animations', description: anim.slice(0, 10).join(' | ') || 'none' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(200);
  for (const t of ['ps2', 'ps3', 'ps4', 'ps5']) {
    await setTheme(page, t);
    const running = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll('html, body, body *')) for (const pe of [null, '::before', '::after']) {
        const s = getComputedStyle(el, pe);
        if (s.animationName !== 'none' && parseFloat(s.animationDuration) > 0.01 && s.animationIterationCount === 'infinite' && s.display !== 'none') out.push(`${el.tagName}.${String(el.className).slice(0, 30)}${pe ?? ''}:${s.animationName}`);
      }
      return out;
    });
    expect(running, `${t}: бесконечные анимации при reduced-motion`).toEqual([]);
  }
});

test('тема: activity -> ps5 записывается обратно, мусор -> Night, нет мигания (cookie на сервере)', async ({ page, context, baseURL, request }) => {
  await boot(page, context, baseURL!);
  const key = 'ps-theme';
  const act = await (await request.get('/login', { headers: { cookie: `${key}=activity` } })).text();
  expect(act).toMatch(/<html[^>]*data-theme="ps5"/);
  const html = await (await request.get('/login', { headers: { cookie: `${key}=ps3` } })).text();
  expect(html).toMatch(/<html[^>]*data-theme="ps3"/);
  const junk = await (await request.get('/login', { headers: { cookie: `${key}=%3Cscript%3E` } })).text();
  expect(junk).not.toMatch(/<html[^>]*data-theme=/);
  expect(junk).not.toContain('<script>alert');
  await page.addInitScript(() => { try { localStorage.setItem('ps-theme', 'activity'); } catch {} });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('ps5');
  expect(await page.evaluate(() => localStorage.getItem('ps-theme'))).toBe('ps5');
  expect(await page.evaluate(() => document.cookie)).toContain('ps-theme=ps5');
});
