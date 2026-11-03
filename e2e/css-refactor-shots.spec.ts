// QA Фазы 19: снимки до/после рефакторинга CSS (SHOTS_DIR). Без SHOTS_DIR пропускается.
import { test, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const SHOTS = process.env.SHOTS_DIR;
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
  await mockApi(page);
  await page.route(/\/api\/stats\?/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: stats(new URL(r.request().url())) }) }));
}

const SCREENS = [['coll', '/'], ['dialog', '/?game=8'], ['dialog-tr', '/?game=8&tab=trophies'], ['stats', '/stats'], ['triage', '/triage'], ['backlog', '/backlog'], ['plan', '/roadmap'], ['recommend', '/recommend']] as const;
for (const t of ['night', 'graphite', 'ps1'] as const) {
  test(`снимки ${t}`, async ({ page, context, baseURL }, info) => {
    test.skip(!SHOTS, 'нужен SHOTS_DIR');
    test.setTimeout(180_000);
    await boot(page, context, baseURL!);
    for (const [name, path] of SCREENS) {
      await page.goto(path);
      await setTheme(page, t);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${SHOTS}/${info.project.name}-${t}-${name}.png`, fullPage: name !== 'dialog' && name !== 'dialog-tr', animations: 'disabled', caret: 'hide' });
    }
  });
}
