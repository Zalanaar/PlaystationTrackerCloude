// D-P6: превью года на хабе Итогов. Мок /api/wrapped по контракту §11; webkit iPhone входит в testMatch.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const Y = Number(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 4));
const LONG = 'Metal Gear Solid Δ: Snake Eater — Master Collection Definitive Edition Remastered';
const game = (id: number, title: string) => ({
  id, title, coverUrl: null, platform: 'PS5', playSeconds: 3600, hours: 1, playCount: 3, lastPlayedAt: null, status: 'completed', completedAt: `${Y - 1}-05-01T10:00:00.000Z`, droppedAt: null, trophies: null, genres: [],
});
type Opt = { year?: number; scope?: 'year' | 'all'; empty?: boolean; best?: boolean; title?: string };
function respond(o: Opt = {}) {
  const y = o.year ?? Y - 1;
  return {
    year: y, scope: o.scope ?? 'year', mode: o.empty ? 'empty' : 'story', slides: o.empty ? ['empty'] : ['start', 'final'], emptyState: o.empty ? { syncStartedOn: null } : null,
    period: { from: `${y}-01-01`, to: `${y}-12-31`, fromUtc: `${y - 1}-12-31T21:00:00.000Z`, toUtc: `${y}-12-31T21:00:00.000Z` },
    years: [{ year: Y, hasData: true }, { year: Y - 1, hasData: true }, { year: Y - 2, hasData: false }],
    profile: { onlineId: 'Artem_PS', avatarUrl: null }, firstSnapshotDate: `${Y - 2}-01-01`, periodPartial: false,
    hours: { hasData: true, total: 803.3, days: 200, byMonth: Array(12).fill(60), estimatedByMonth: Array(12).fill(0), estimatedHours: 12, hasEstimate: true, topMonth: { month: 3, hours: 99 } },
    topGames: { hasData: true, items: [{ rank: 1, seconds: 49.6 * 3600, hours: 49.6, estimated: false, game: game(3, o.title ?? 'Clair Obscur: Expedition 33') }] },
    finished: { hasData: true, completed: { count: 21, items: [] }, dropped: { count: 17, items: [] }, busiestMonth: null },
    trophies: { hasData: true, counts: { platinum: 7, gold: 50, silver: 200, bronze: 810, total: 1067 }, platinum: { first: null, last: null, rarest: null }, rare: [] },
    genres: { hasData: false, items: [] },
    longestGame: { hasData: false, seconds: 0, hours: 0, estimated: false, playCount: 0, game: null },
    bestGame: o.best ? { hasData: true, rating: 9, hours: 42.5, estimated: false, game: game(7, 'Astro Bot') } : { hasData: false, rating: null, hours: 0, estimated: false, game: null },
  };
}

async function open(page: Page, context: BrowserContext, baseURL: string, o: Opt = {}, delayMs = 0) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  await page.route(/\/api\/wrapped/, async (r) => {
    const q = new URL(r.request().url()).searchParams.get('year');
    if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
    const body = q === 'all' ? respond({ ...o, scope: 'all' }) : q === String(Y - 2) ? respond({ ...o, year: Y - 2, empty: true }) : respond(o);
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: body }) });
  });
  await page.goto(`/wrapped?year=${Y - 1}`);
}
const card = (page: Page) => page.getByTestId('wpreview');

test('цифры года: часы ≈, пройдено и брошено, трофеи, платины, игра с наибольшими часами', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!);
  await expect(card(page).getByRole('heading', { level: 2, name: String(Y - 1) })).toBeVisible();
  await expect(card(page).getByText('Превью · твой год')).toBeVisible();
  await expect(page.getByTestId('wpreview-hours')).toHaveText('≈ 803,3 ч');
  await expect(page.getByTestId('wpreview-done')).toHaveText('21');
  await expect(card(page).getByText('пройдено · 17 брошено')).toBeVisible();
  await expect(page.getByTestId('wpreview-trophies')).toHaveText('1 067');
  await expect(page.getByTestId('wpreview-plat')).toHaveText('7');
  await expect(card(page).getByText('платин', { exact: true })).toBeVisible();
  await expect(page.getByTestId('wpreview-game')).toContainText('Больше всего часов');
  await expect(page.getByTestId('wpreview-game')).toContainText('Clair Obscur: Expedition 33');
  await expect(page.getByTestId('wpreview-game')).toContainText('49,6 ч');
});

test('«Игра года» по моей оценке, если она есть', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, { best: true });
  await expect(page.getByTestId('wpreview-game')).toContainText('Игра года');
  await expect(page.getByTestId('wpreview-game')).toContainText('Astro Bot');
  await expect(page.getByTestId('wpreview-game')).toContainText('★ 9');
});

test('год без данных — короткий текст; «Всё время» — без превью', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!);
  await expect(card(page)).toBeVisible();
  await page.getByRole('group', { name: 'Год' }).getByRole('button', { name: String(Y - 2) }).click();
  await expect(card(page)).toHaveAttribute('data-empty', 'true');
  await expect(card(page)).toContainText('пока нет данных');
  await page.getByRole('button', { name: /Всё время/ }).click();
  await expect(page.getByRole('button', { name: 'Смотреть итоги за всё время' })).toBeEnabled();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByTestId('wpreview-skeleton')).toHaveCount(0);
});

test('длинное название в одну строку, ничего не вылезает; кнопка «Смотреть итоги» не сдвигается после загрузки', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, { title: LONG }, 900);
  const go = page.getByRole('button', { name: 'Смотреть итоги' });
  const sk = page.getByTestId('wpreview-skeleton');
  await expect(sk).toBeVisible();
  const s0 = (await sk.boundingBox())!;
  const gap0 = (await go.boundingBox())!.y - s0.y;
  await expect(card(page)).toBeVisible();
  // карточка той же высоты, что скелет: кнопка под ней не сдвигается (ряд годов над ними — отдельный скелет, вне D-P6)
  const c1 = (await card(page).boundingBox())!;
  expect(c1.height).toBe(s0.height);
  expect((await go.boundingBox())!.y - c1.y).toBe(gap0);
  const m = await card(page).evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, sw: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  expect(m.sh).toBeLessThanOrEqual(m.ch);
  expect(m.sw).toBeLessThanOrEqual(0);
  const t = page.locator('.ps-wpreview__gt');
  expect(await t.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true); // обрезано многоточием, полное название в title
  await expect(t).toHaveAttribute('title', LONG);
});
