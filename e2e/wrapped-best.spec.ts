// Пакет 3: слайд Итогов «Лучшая игра года» по моей оценке (F1). Мок /api/wrapped по контракту §11 (+ bestGame).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const Y = Number(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 4));
const LONG = 'Metal Gear Solid Δ: Snake Eater — Master Collection Definitive Edition Remastered';
const game = (id: number, title: string) => ({
  id, title, coverUrl: null, platform: 'PS5', playSeconds: 3600, hours: 1, playCount: 3, lastPlayedAt: null, status: 'completed', completedAt: `${Y}-05-01T10:00:00.000Z`, droppedAt: null, trophies: null, genres: [],
});
const zeroC = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };

function respond(best: { rating: number; hours: number; title: string } | null) {
  return {
    year: Y, scope: 'year', mode: 'story', slides: best ? ['start', 'bestGame', 'final'] : ['start', 'final'], emptyState: null,
    period: { from: `${Y}-01-01`, to: `${Y}-12-31`, fromUtc: `${Y - 1}-12-31T21:00:00.000Z`, toUtc: `${Y}-12-31T21:00:00.000Z` },
    years: [{ year: Y, hasData: true }], profile: { onlineId: 'Artem_PS', avatarUrl: null }, firstSnapshotDate: `${Y}-01-01`, periodPartial: false,
    hours: { hasData: false, total: null, days: null, byMonth: Array(12).fill(null), estimatedByMonth: Array(12).fill(0), estimatedHours: 0, hasEstimate: false, topMonth: null },
    topGames: { hasData: false, items: [] },
    finished: { hasData: false, completed: { count: 0, items: [] }, dropped: { count: 0, items: [] }, busiestMonth: null },
    trophies: { hasData: false, counts: zeroC, platinum: { first: null, last: null, rarest: null }, rare: [] },
    genres: { hasData: false, items: [] },
    longestGame: { hasData: false, seconds: 0, hours: 0, estimated: false, playCount: 0, game: null },
    bestGame: best ? { hasData: true, rating: best.rating, hours: best.hours, estimated: false, game: game(7, best.title) } : { hasData: false, rating: null, hours: 0, estimated: false, game: null },
  };
}

async function open(page: Page, context: BrowserContext, baseURL: string, best: Parameters<typeof respond>[0]) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  await page.route(/\/api\/wrapped/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: respond(best) }) }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/wrapped');
  await page.getByRole('button', { name: 'Смотреть итоги' }).click();
  await expect(page.locator('.ps-story__stage')).toBeFocused();
}
const slideId = (page: Page) => page.locator('.ps-story__stage').getAttribute('data-slide');

test('слайд «Лучшая игра года»: обложка, название, ★ оценка, часы года; перед финалом', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, { rating: 9, hours: 42.5, title: 'Astro Bot' });
  await expect(page.locator('.ps-story__seg')).toHaveCount(3);
  await page.keyboard.press('ArrowRight');
  expect(await slideId(page)).toBe('bestGame');
  await expect(page.getByRole('heading', { name: 'Лучшая игра года' })).toBeVisible();
  await expect(page.locator('.ps-story__gtitle')).toHaveText('Astro Bot');
  await expect(page.getByTestId('best-rating')).toHaveText('★ 9 из 10');
  await expect(page.getByText('42,5 ч в этом году')).toBeVisible();
  await expect(page.getByText('По твоей оценке')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  expect(await slideId(page)).toBe('final');
});

test('длинное название, игра без часов (пройдена вне PSN): в экран, без строки часов', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, { rating: 10, hours: 0, title: LONG });
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('best-rating')).toHaveText('★ 10 из 10');
  await expect(page.getByText(/ч в этом году/)).toHaveCount(0);
  const vp = page.viewportSize()!;
  for (const sel of ['.ps-story__gtitle', '[data-testid="best-rating"]']) {
    const b = (await page.locator(sel).boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 1);
    expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 1);
  }
  expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined|null/);
});

test('без оценённых игр года слайда нет', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, null);
  await expect(page.locator('.ps-story__seg')).toHaveCount(2);
});
