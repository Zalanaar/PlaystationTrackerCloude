// Пакет 7, п. 2: офлайн-просмотр. Только production-сборка (e2e/pwa.config.ts): копия пишется, когда страницей управляет SW.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { signedSession } from './session';

const ORIGIN = () => process.env.PWA_ORIGIN ?? `http://localhost:${process.env.PWA_PORT ?? 3231}`;
const KEY = '/offline-data/snapshot.json';

const game = (id: number, title: string, o: Record<string, unknown> = {}) => ({
  id, title, coverUrl: null, platform: 'PS5', status: null, hours: 0, lastPlayedAt: null, completedAt: null, trophies: null, durationHours: null, ...o,
});
const snapshot = (profileId: number, generatedAt: string) => ({
  v: 2, generatedAt, profileId, onlineId: profileId === 1 ? 'Zalanaar' : 'Friend',
  totals: { games: 4, hours: 321.5, trophiesEarned: 777, platinumEarned: 12 },
  counts: { playing: 1, completed: 1, dropped: 0, backlog: 2, shelved: 0 },
  games: [
    game(1, 'Astro Bot', { status: 'playing', hours: 12.5, trophies: [30, 48, false] }),
    game(2, 'Elden Ring', { status: 'completed', hours: 140, trophies: [42, 42, true] }),
    game(3, 'Bloodborne', { status: 'backlog', durationHours: 35 }),
    game(4, 'Ghost of Yotei', { status: 'backlog' }),
  ],
  backlog: [4, 3],
  stats: { year: 2026, completed: 5, dropped: 1, hours: 210, platinum: 3, hoursByMonth: [10, 20, 0, 5, null, null, 30, 40, 50, 25, 30, 0], topByHours: [{ title: 'Elden Ring', hours: 80 }] },
  plan: { year: 2026, status: 'ok', hoursPerWeek: 10, capacityHours: 520, plannedHours: 20, notFit: 0, items: [{ title: 'GTA VI', coverUrl: null, start: '2026-12-05', end: '2026-12-18', hours: 20, kind: 'release' }] },
});

async function setup(ctx: BrowserContext, active: { id: number }) {
  await ctx.addCookies([{ name: 'pst_session', value: await signedSession(), url: ORIGIN() }]);
  const ok = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  // context.route ловит и запросы страницы, прошедшие через service worker
  await ctx.route('**/api/auth/me', (r) => r.fulfill(ok({
    id: active.id, loginId: 1, activeProfileId: active.id, email: 'a@example.com', displayName: null, role: 'owner', amr: 'google',
    profiles: [{ id: 1, onlineId: 'Zalanaar', isPrimary: true }, { id: 2, onlineId: 'Friend', isPrimary: false }],
  })));
  await ctx.route('**/api/offline/snapshot', (r) => r.fulfill(ok(snapshot(active.id, new Date().toISOString()))));
}

async function swReady(page: Page) {
  await expect.poll(async () => {
    try { return await page.evaluate(async () => { await navigator.serviceWorker.ready; return !!navigator.serviceWorker.controller; }); } catch { return false; }
  }, { timeout: 20_000 }).toBe(true);
  await page.waitForLoadState('load');
}

const stored = (page: Page) => page.evaluate(async (key) => {
  const hit = await (await caches.open('ps-data')).match(key);
  return hit ? ((await hit.json()) as { profileId: number }).profileId : null;
}, KEY).catch(() => null);

/** Первый заход без сети на этот документ: SW отдаёт /offline, Playwright.goto часто бросает. Без location.replace — OfflineRetry на `online` уводит на «/». */
async function firstOfflineLand(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await expect(page.getByRole('heading', { name: 'Нет сети' })).toBeVisible();
}

test('копия пишется под SW; без сети /backlog показывает её только для просмотра с «Данные от …»; вход без сессии её стирает', async ({ page, context }) => {
  const active = { id: 1 };
  await setup(context, active);
  await page.goto('/stats');
  await swReady(page);
  await page.reload(); // первая загрузка шла без controller: копия пишется со второй
  await expect.poll(() => stored(page), { timeout: 15_000 }).toBe(1);
  // в кэше по-прежнему нет /api и закрытого HTML
  const paths = await page.evaluate(async () => {
    const out: string[] = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
    return out;
  });
  expect(paths.filter((p) => p.startsWith('/api') || ['/', '/stats', '/backlog'].includes(p))).toEqual([]);

  const api: string[] = [];
  page.on('request', (rq) => { if (new URL(rq.url()).pathname.startsWith('/api/')) api.push(rq.url()); });
  await context.setOffline(true);
  await firstOfflineLand(page, '/backlog');
  const view = page.getByTestId('offline-snapshot');
  await expect(view).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Нет сети' })).toBeVisible();
  await expect(view).toContainText('Сохранённая копия, только просмотр');
  await expect(view).toContainText('Zalanaar');
  await expect(page.getByTestId('offline-asof')).toHaveText(/^Данные от \d{1,2} [а-я]+\.?, \d{2}:\d{2}$/);
  // открыт «Бэклог» (адрес /backlog), порядок сохранённый, правок нет
  await expect(page.getByRole('tab', { name: 'Что дальше' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('offline-backlog-sum')).toHaveText('2 в бэклоге · ≈ 35 ч · без длительности: 1');
  await expect(page.getByTestId('offline-game').locator('.ps-offline__gname')).toHaveText(['Ghost of Yotei', 'Bloodborne']);
  await expect(view.locator('select, input, [role="menu"]')).toHaveCount(0);
  // вкладки «План» и «Статистика» с той же копии (клик, без второго document-goto: он в CI ловит `online` и уводит на /)
  await page.getByRole('tab', { name: 'План' }).click();
  await expect(page.getByRole('tab', { name: 'План' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('offline-plan-sum')).toHaveText('1 игра · 20 ч из 520 ч');
  await expect(page.getByTestId('offline-plan-item')).toContainText('GTA VI');
  await expect(page.getByTestId('offline-plan-item')).toContainText('На релизе');
  await page.getByRole('tab', { name: 'Статистика' }).click();
  await expect(page.getByRole('tab', { name: 'Статистика' })).toHaveAttribute('aria-selected', 'true');
  await expect(view).toContainText('2026 год');
  await expect(view).toContainText('Elden Ring');
  await expect(view).toContainText('321 ч');
  // «Коллекция»: фильтр по статусу
  await page.getByRole('tab', { name: 'Коллекция' }).click();
  await expect(page.getByTestId('offline-game')).toHaveCount(4);
  await page.getByRole('group', { name: 'Фильтр по статусу' }).getByRole('button', { name: /Пройдено/ }).click();
  await expect(page.getByTestId('offline-game')).toHaveCount(1);
  await expect(page.getByTestId('offline-game')).toContainText('42/42 · платина');
  // тап-зоны вкладок ≥ 44, без горизонтального скролла
  for (const b of await page.getByRole('tab').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  expect(api).toEqual([]);

  // сессии нет (выход, истекла, отозвана): страница входа стирает копию
  await context.setOffline(false);
  await context.clearCookies();
  await page.goto('/login');
  await expect.poll(() => stored(page), { timeout: 10_000 }).toBeNull();
  await context.setOffline(true);
  await firstOfflineLand(page, '/stats');
  await expect(page.getByRole('heading', { name: 'Нет сети' })).toBeVisible();
  await expect(page.getByTestId('offline-snapshot')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Zalanaar');
});

test('без сети первый заход на /roadmap и /stats открывает «План» и «Статистику» с «Данные от …»', async ({ page, context }) => {
  const active = { id: 1 };
  await setup(context, active);
  await page.goto('/');
  await swReady(page);
  await page.reload();
  await expect.poll(() => stored(page), { timeout: 15_000 }).toBe(1);
  await context.setOffline(true);

  const road = await context.newPage();
  await firstOfflineLand(road, '/roadmap');
  await expect(road.getByTestId('offline-asof')).toHaveText(/^Данные от \d{1,2} [а-я]+\.?, \d{2}:\d{2}$/);
  await expect(road.getByRole('tab', { name: 'План' })).toHaveAttribute('aria-selected', 'true');
  await expect(road.getByTestId('offline-plan-item')).toContainText('GTA VI');
  await road.close();

  const stats = await context.newPage();
  await firstOfflineLand(stats, '/stats');
  await expect(stats.getByTestId('offline-asof')).toHaveText(/^Данные от \d{1,2} [а-я]+\.?, \d{2}:\d{2}$/);
  await expect(stats.getByRole('tab', { name: 'Статистика' })).toHaveAttribute('aria-selected', 'true');
  await expect(stats.getByTestId('offline-snapshot')).toContainText('2026 год');
  await stats.close();
});

test('смена профиля стирает копию прежнего; новая копия — только активного', async ({ page, context }) => {
  const active = { id: 1 };
  await setup(context, active);
  await page.goto('/stats');
  await swReady(page);
  await page.reload();
  await expect.poll(() => stored(page), { timeout: 15_000 }).toBe(1);
  // копию чужого профиля (смена профиля в другой вкладке) не показываем и перезаписываем: активный теперь 2
  active.id = 2;
  await page.reload();
  await expect.poll(() => stored(page), { timeout: 15_000 }).toBe(2);
  await context.setOffline(true);
  await page.goto('/').catch(() => {});
  await expect(page.getByTestId('offline-snapshot')).toContainText('Friend');
  await expect(page.getByTestId('offline-snapshot')).not.toContainText('Zalanaar');
});

test('t281u П.9: без сети касание вкладки открывает тот же раздел офлайн-копии, а не общий /offline', async ({ page, context }) => {
  const active = { id: 1 };
  await setup(context, active);
  await page.goto('/');
  await swReady(page);
  await page.reload();
  await expect.poll(() => stored(page), { timeout: 15_000 }).toBe(1);
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.getByRole('link', { name: 'Статистика' }).filter({ visible: true }).first().click();
  await page.waitForURL(/\/stats$/, { timeout: 10_000 });
  await expect(page.getByTestId('offline-asof')).toHaveText(/^Данные от /);
  await expect(page.getByRole('tab', { name: 'Статистика' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Раздел недоступен без сети', { exact: false })).toHaveCount(0);
});
