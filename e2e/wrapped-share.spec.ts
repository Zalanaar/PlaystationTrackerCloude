// П8.3: «Поделиться» на финальном слайде Итогов года: картинка готовится заранее (GET /api/wrapped/share под сессией),
// Web Share с файлом (iOS), иначе скачивание; ошибка — «Повторить». Картинка эмулируется (в e2e нет БД).
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const Y = Number(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 4));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const game = (id: number, title: string) => ({ id, title, coverUrl: null, platform: 'PS5', playSeconds: 1, hours: 1, playCount: 1, lastPlayedAt: null, status: 'completed', completedAt: null, droppedAt: null, trophies: null, genres: [] });
const data = {
  year: Y, scope: 'year', mode: 'story', period: { from: `${Y}-01-01`, to: `${Y}-12-31`, fromUtc: null, toUtc: null }, years: [{ year: Y, hasData: true }], profile: { onlineId: 'Zalanaar26', avatarUrl: null },
  firstSnapshotDate: null, periodPartial: false, slides: ['start', 'final'], emptyState: null,
  hours: { hasData: true, total: 412.4, days: 17.2, byMonth: Array(12).fill(null), topMonth: null, estimatedByMonth: Array(12).fill(0), estimatedHours: 0, hasEstimate: false },
  topGames: { hasData: true, items: [1, 2, 3].map((r) => ({ rank: r, seconds: 1, hours: 50 - r, estimated: false, game: game(r, `Игра ${r}`) })) },
  finished: { hasData: true, completed: { count: 12, items: [] }, dropped: { count: 0, items: [] }, busiestMonth: null },
  trophies: { hasData: true, counts: { platinum: 7, gold: 1, silver: 1, bronze: 1, total: 366 }, platinum: { first: null, last: null, rarest: null }, rare: [] },
  genres: { hasData: false, items: [] }, longestGame: { hasData: false, seconds: 0, hours: 0, estimated: false, playCount: 0, game: null },
};

async function open(page: Page, context: BrowserContext, baseURL: string, share: { status: number; delay?: number }) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  await page.route(/\/api\/wrapped\?|\/api\/wrapped$/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) }));
  const calls: string[] = [];
  await page.route(/\/api\/wrapped\/share/, async (r) => {
    calls.push(r.request().url());
    if (share.delay) await new Promise((res) => setTimeout(res, share.delay));
    return share.status === 200
      ? r.fulfill({ status: 200, contentType: 'image/png', headers: { 'cache-control': 'private, no-store' }, body: PNG })
      : r.fulfill({ status: share.status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'internal_error', message: 'x' } }) });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/wrapped');
  await page.getByRole('button', { name: 'Смотреть итоги' }).click();
  await expect(page.locator('.ps-story__stage')).toBeFocused();
  return calls;
}

test('кнопки нет до финала; на финале картинка заранее, Web Share получает PNG-файл в нажатии', async ({ page, context, baseURL }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __shared: unknown[] };
    w.__shared = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d: { files?: File[] }) => !!d.files?.length });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (d: { files: File[]; title: string }) => { w.__shared.push({ n: d.files.length, name: d.files[0].name, type: d.files[0].type, size: d.files[0].size, title: d.title }); } });
  });
  const calls = await open(page, context, baseURL!, { status: 200, delay: 300 });
  await expect(page.getByTestId('story-share')).toHaveCount(0);
  expect(calls).toEqual([]);
  await page.keyboard.press('ArrowRight');
  const btn = page.getByTestId('story-share');
  await expect(btn).toBeDisabled();
  await expect(btn).toHaveText('Готовим картинку…');
  await expect(btn).toHaveText('Поделиться');
  expect(calls.map((u) => new URL(u).search)).toEqual([`?year=${Y}`]);
  await btn.click();
  expect(await page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared)).toEqual([{ n: 1, name: `itogi-${Y}.png`, type: 'image/png', size: PNG.length, title: `Итоги ${Y}` }]);
});

test('без Web Share с файлами — скачивание PNG', async ({ page, context, baseURL }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false }); });
  await open(page, context, baseURL!, { status: 200 });
  await page.keyboard.press('ArrowRight');
  const btn = page.getByTestId('story-share');
  await expect(btn).toHaveText('Поделиться');
  const [dl] = await Promise.all([page.waitForEvent('download'), btn.click()]);
  expect(dl.suggestedFilename()).toBe(`itogi-${Y}.png`);
  await expect(page.getByText('Картинка сохранена')).toBeVisible();
});

test('ошибка сервера — «Повторить», повтор загружает картинку', async ({ page, context, baseURL }) => {
  const share = { status: 500 };
  const calls = await open(page, context, baseURL!, share);
  await page.keyboard.press('ArrowRight');
  const btn = page.getByTestId('story-share');
  await expect(btn).toHaveText('Повторить');
  await expect(page.getByText('Не удалось подготовить картинку')).toBeVisible();
  share.status = 200;
  await btn.click();
  await expect(btn).toHaveText('Поделиться');
  expect(calls.length).toBe(2);
});
