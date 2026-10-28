import { test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

const TODAY = { year: Number(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 4)), month: Number(new Date(Date.now() + 3 * 3600_000).toISOString().slice(5, 7)) };
const FIRST = `${TODAY.year}-01-15`;
const z = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };

const game = (id: number, title: string, status: 'completed' | 'dropped') => ({
  id, title, coverUrl: null, platform: 'PS5', playSeconds: 36000, hours: 10, playCount: 3, lastPlayedAt: '2026-03-10T10:00:00.000Z',
  status, completedAt: status === 'completed' ? '2026-03-10T10:00:00.000Z' : null, droppedAt: status === 'dropped' ? '2026-03-12T10:00:00.000Z' : null,
  trophies: null, genres: [{ key: 'ACTION', label: 'Экшен' }],
});

type Opts = { empty?: boolean; hoursNull?: boolean; estimate?: boolean };
/** Ответ по контракту §10.1 для разобранных параметров. */
function respond(u: URL, o: Opts = {}) {
  const type = u.searchParams.get('period') === 'month' ? 'month' : 'year';
  const year = Number(u.searchParams.get('year') ?? TODAY.year);
  const month = type === 'month' ? Number(u.searchParams.get('month')) : null;
  const last = month ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 31;
  const p = (n: number) => String(n).padStart(2, '0');
  const has = !o.empty && year >= TODAY.year - 1;
  const byMonth = Array.from({ length: 12 }, (_, i) => (year < TODAY.year ? null : i + 1 > TODAY.month ? null : i === 0 ? (o.estimate ? 5 : null) : 10 + i));
  return {
    period: {
      type, year, month, from: `${year}-${p(month ?? 1)}-01`, to: `${year}-${p(month ?? 12)}-${p(last)}`,
      fromUtc: new Date(Date.UTC(year, (month ?? 1) - 1, 1) - 3 * 3600_000).toISOString(), toUtc: new Date(Date.UTC(year, (month ?? 12) - 1, last + 1) - 3 * 3600_000).toISOString(),
    },
    years: [TODAY.year, TODAY.year - 1],
    header: { completed: has ? 1 : 0, dropped: has ? 1 : 0, hours: o.hoursNull || year < TODAY.year ? null : has ? 123.4 : 0, platinum: has ? 2 : 0 },
    hours: {
      byMonth: has ? byMonth : byMonth.map(() => null),
      // оценка: январь целиком оценочный, февраль частично (контракт §10.1: estimatedByMonth <= byMonth)
      estimatedByMonth: has && o.estimate && year === TODAY.year ? byMonth.map((v, i) => (i === 0 ? 5 : i === 1 && v ? 4 : 0)) : Array(12).fill(0),
      estimatedHours: has && o.estimate ? 9 : 0, hasEstimate: !!has && !!o.estimate,
      firstSnapshotDate: FIRST, periodPartial: year <= TODAY.year && (month ?? 1) <= 1 || year < TODAY.year },
    genres: has
      ? { hasData: true, items: [{ key: 'ACTION', label: 'Экшен', value: 14.5, gameIds: [1, 2] }, { key: 'OTHER', label: 'Другое', value: 3, gameIds: [2] }], games: { 1: { id: 1, title: 'Игра Один', coverUrl: null }, 2: { id: 2, title: 'Игра Два', coverUrl: null } } }
      : { hasData: false, items: [], games: {} },
    top: has
      ? {
        byHours: [{ game: game(1, 'Игра Один', 'completed'), hours: 12.5, estimated: false }, { game: game(2, 'Игра Два', 'dropped'), hours: 2, estimated: true }],
        byTrophies: [{ game: game(1, 'Игра Один', 'completed'), points: 840, counts: { platinum: 1, gold: 5, silver: 12, bronze: 20, total: 38 } }],
      }
      : { byHours: [], byTrophies: [] },
    trophies: {
      counts: has ? { platinum: 2, gold: 3, silver: 4, bronze: 5, total: 14 } : z,
      byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...(has && i === 2 ? { platinum: 2, gold: 3, silver: 4, bronze: 5, total: 14 } : z) })),
    },
    finished: has
      ? { groups: [{ month: `${year}-03`, year, monthNumber: 3, items: [{ kind: 'completed', at: '2026-03-10T10:00:00.000Z', game: game(1, 'Игра Один', 'completed') }, { kind: 'dropped', at: '2026-03-12T10:00:00.000Z', game: game(2, 'Игра Два', 'dropped') }] }] }
      : { groups: [] },
    // «Игры месяца» (Фаза 8): мартовские завершения + «Игра Один» ещё и в феврале (играли, но не завершили)
    played: has
      ? { groups: [
        { month: `${year}-03`, year, monthNumber: 3, completed: 1, dropped: 1, items: [
          { game: game(2, 'Игра Два', 'dropped'), hours: 2, estimated: false, finished: 'dropped', finishedAt: '2026-03-12T10:00:00.000Z' },
          { game: game(1, 'Игра Один', 'completed'), hours: 12.5, estimated: false, finished: 'completed', finishedAt: '2026-03-10T10:00:00.000Z' },
        ] },
        { month: `${year}-02`, year, monthNumber: 2, completed: 0, dropped: 0, items: [
          { game: game(1, 'Игра Один', 'completed'), hours: 7.5, estimated: true, finished: null, finishedAt: null },
        ] },
      ] }
      : { groups: [] },
  };
}


const NOW_YEAR = Number(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 4));
const Y_FULL = NOW_YEAR; // story, 8 слайдов
const Y_TROPHY = NOW_YEAR - 1; // нет часов, есть трофеи
const Y_EMPTY = NOW_YEAR - 2; // empty
const WFIRST = `${NOW_YEAR}-03-04`;

const wgame = (id: number, title: string, status: 'completed' | 'dropped' | null = null) => ({
  id, title, coverUrl: null, platform: 'PS5', playSeconds: 101853, hours: 28.3, playCount: 19, lastPlayedAt: '2026-03-10T10:00:00.000Z',
  status, completedAt: status === 'completed' ? '2026-10-05T18:42:11.000Z' : null, droppedAt: status === 'dropped' ? '2026-08-01T10:00:00.000Z' : null,
  trophies: null, genres: [{ key: 'ACTION', label: 'Экшен' }],
});
const wzeroC = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };
const wplat = { at: '2026-01-12T20:00:00.000Z', name: 'Платина', earnedRate: 4.3, rarity: 1, setName: 'Horizon', game: wgame(1, 'Horizon Forbidden West') };

type WProf = { onlineId: string | null; avatarUrl: string | null };
function wrespond(year: number, est = false, profile: WProf = { onlineId: 'Artem_PS', avatarUrl: null }) {
  const full = year === Y_FULL;
  const trophy = year === Y_TROPHY;
  const base = {
    year,
    period: { from: `${year}-01-01`, to: `${year}-12-31`, fromUtc: `${year - 1}-12-31T21:00:00.000Z`, toUtc: `${year}-12-31T21:00:00.000Z` },
    years: [{ year: Y_FULL, hasData: true }, { year: Y_TROPHY, hasData: true }, { year: Y_EMPTY, hasData: false }],
    profile,
    firstSnapshotDate: WFIRST,
    periodPartial: true,
  };
  if (!full && !trophy) {
    return {
      ...base, mode: 'empty', slides: ['empty'], emptyState: { syncStartedOn: WFIRST },
      hours: { hasData: false, total: null, days: null, byMonth: Array(12).fill(null), estimatedByMonth: Array(12).fill(0), estimatedHours: 0, hasEstimate: false, topMonth: null },
      topGames: { hasData: false, items: [] },
      finished: { hasData: false, completed: { count: 0, items: [] }, dropped: { count: 0, items: [] }, busiestMonth: null },
      trophies: { hasData: false, counts: wzeroC, platinum: { first: null, last: null, rarest: null } },
      genres: { hasData: false, items: [] },
      longestGame: { hasData: false, seconds: 0, hours: 0, estimated: false, playCount: 0, game: null },
    };
  }
  const counts = { platinum: 7, gold: 31, silver: 88, bronze: 240, total: 366 };
  const trophies = { hasData: true, counts, platinum: { first: wplat, last: wplat, rarest: wplat } };
  const finished = {
    hasData: true,
    completed: { count: 12, items: [1, 2, 3, 4, 5].map((i) => ({ at: '2026-10-05T18:42:11.000Z', game: wgame(10 + i, `Пройденная ${i}`, 'completed') })) },
    dropped: { count: 3, items: [1, 2].map((i) => ({ at: '2026-08-01T10:00:00.000Z', game: wgame(20 + i, `Брошенная ${i}`, 'dropped') })) },
    busiestMonth: { month: 10, count: 4 },
  };
  const genres = { hasData: true, items: [{ key: 'ACTION', label: 'Экшен', value: 14.5 }, { key: 'RPG', label: 'Ролевые', value: 6 }, { key: 'OTHER', label: 'Другое', value: 2 }] };
  if (trophy) {
    return {
      ...base, mode: 'story', slides: ['start', 'finished', 'trophies', 'genres', 'final'], emptyState: null,
      hours: { hasData: false, total: null, days: null, byMonth: Array(12).fill(null), estimatedByMonth: Array(12).fill(0), estimatedHours: 0, hasEstimate: false, topMonth: null },
      topGames: { hasData: false, items: [] }, finished, trophies, genres,
      longestGame: { hasData: false, seconds: 0, hours: 0, estimated: false, playCount: 0, game: null },
    };
  }
  return {
    ...base, mode: 'story', slides: ['start', 'hours', 'topGames', 'finished', 'trophies', 'genres', 'longestGame', 'final'], emptyState: null,
    hours: {
      hasData: true, total: 412.4, days: 17.2, byMonth: Array(12).fill(null), topMonth: { month: 10, hours: 85 },
      estimatedByMonth: Array(12).fill(0), estimatedHours: est ? 26 : 0, hasEstimate: est,
    },
    topGames: { hasData: true, items: [1, 2, 3, 4, 5].map((r) => ({ rank: r, seconds: 100000 / r, hours: 30 - r, estimated: est && r <= 2, game: wgame(r, `Игра ${r}`) })) },
    finished, trophies, genres,
    longestGame: { hasData: true, seconds: 101853, hours: 28.3, estimated: est, playCount: 19, game: wgame(1, 'Horizon Forbidden West') },
  };
}


const OUT = process.env.SHOTS_OUT!;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];
const SIZES = { desktop: { width: 1440, height: 900 }, m390: { width: 390, height: 844 } } as const;
const svg = (i: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${i * 47 % 360} 70% 50%)"/><stop offset="1" stop-color="hsl(${(i * 47 + 80) % 360} 60% 20%)"/></linearGradient></defs><rect width="300" height="400" fill="url(#g)"/></svg>`;

async function setup(page: Page, context: import('@playwright/test').BrowserContext, baseURL: string, theme: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }, { name: 'ps-theme', value: theme, url: baseURL }]);
  await page.route('https://img.test/**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: svg(Number(r.request().url().match(/(\d+)\.svg/)?.[1] ?? 1)) }));
  const games = seed().map((g, i) => ({ ...g, coverUrl: `https://img.test/${g.id}.svg`, bannerUrl: g.id === 3 ? 'https://img.test/33.svg' : null, platform: 'PS5' as const }));
  games.push({ ...games[2], id: 30, title: 'Elden Ring', status: 'playing', coverUrl: 'https://img.test/30.svg', bannerUrl: null, lastPlayedAt: '2026-10-19T10:00:00.000Z' });
  const m = await mockApi(page, games);
  m.profile = { onlineId: 'Artem_PS', avatarUrl: null, level: 312, levelProgress: 40, tier: 6, trophies: { platinum: 12, gold: 80, silver: 200, bronze: 900, total: 1192 } };
  await page.route(/\/api\/stats\?/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: respond(new URL(r.request().url()), { estimate: true }) }) }));
  await page.route(/\/api\/wrapped/, (r) => {
    const u = new URL(r.request().url());
    const year = Number(u.searchParams.get('year') ?? NOW_YEAR);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: wrespond(year, false) }) });
  });
}

for (const size of Object.keys(SIZES) as (keyof typeof SIZES)[]) {
  for (const th of THEMES) {
    test(`shots ${size} ${th}`, async ({ page, context, baseURL }) => {
      test.setTimeout(120_000);
      mkdirSync(OUT, { recursive: true });
      await page.setViewportSize(SIZES[size]);
      await setup(page, context, baseURL!, th);
      const shot = (n: string, full = false) => page.screenshot({ path: `${OUT}/${size}-${th}-${n}.png`, fullPage: full });
      await page.goto('/');
      await page.waitForSelector('.ps-card');
      await page.waitForTimeout(600);
      await shot('collection');
      await shot('collection-full', true);
      // список
      await page.getByRole('button', { name: 'Список' }).first().click().catch(() => {});
      await page.waitForTimeout(400);
      await shot('collection-list');
      await page.getByRole('button', { name: 'Крупно' }).first().click().catch(() => {});
      await page.getByRole('button', { name: /Открыть: Stray/ }).first().click();
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(700);
      await shot('game');
      await page.keyboard.press('Escape');
      await page.goto('/stats');
      await page.waitForSelector('.ps-st-bar');
      await page.waitForTimeout(700);
      await shot('stats');
      await shot('stats-full', true);
      await page.goto('/wrapped');
      await page.waitForSelector('button.ps-wrapped-year');
      await page.waitForTimeout(300);
      await shot('wrapped');
      await page.getByRole('button', { name: 'Смотреть итоги' }).click();
      await page.waitForSelector('.ps-story__stage');
      await page.waitForTimeout(500);
      await shot('story-1');
      for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); }
      await page.waitForTimeout(600);
      await shot('story-5');
    });
  }
}
