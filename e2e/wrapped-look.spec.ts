// П8.2: обновлённый визуал историй «Итогов»: размытые обложки (или мозаика) фоном, свой цвет слайда, крупные анимированные числа,
// финальная карточка-сводка года; reduced-motion — без анимации. Обложки — локальные PNG через route (без сети).
import { createRequire } from 'node:module';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { mockApi } from './collection-mock';
import { signedSession } from './session';
const Y = Number(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 4));
const game = (id: number, title: string) => ({ id, title, coverUrl: `https://image.api.playstation.com/c${id % 5}.png`, platform: 'PS5', playSeconds: 101853, hours: 28.3, playCount: 19, lastPlayedAt: '2026-03-10T10:00:00.000Z', status: 'completed', completedAt: '2026-10-05T18:42:11.000Z', droppedAt: null, trophies: null, genres: [] });
const plat = { at: '2026-01-12T20:00:00.000Z', name: 'Платина', earnedRate: 4.3, rarity: 1, setName: 'Horizon', game: game(1, 'Horizon Forbidden West') };
const data = {
  year: Y, scope: 'year', mode: 'story', period: { from: `${Y}-01-01`, to: `${Y}-12-31`, fromUtc: null, toUtc: null }, years: [{ year: Y, hasData: true }], profile: { onlineId: 'Zalanaar26', avatarUrl: null },
  firstSnapshotDate: null, periodPartial: false, slides: ['start', 'hours', 'topGames', 'finished', 'trophies', 'genres', 'longestGame', 'bestGame', 'final'], emptyState: null,
  hours: { hasData: true, total: 412.4, days: 17.2, byMonth: Array(12).fill(null), topMonth: { month: 10, hours: 85 }, estimatedByMonth: Array(12).fill(0), estimatedHours: 0, hasEstimate: false },
  topGames: { hasData: true, items: [1, 2, 3, 4, 5].map((r) => ({ rank: r, seconds: 1, hours: 60 - r * 7, estimated: false, game: game(r, ['Astro Bot', 'Final Fantasy VII Rebirth', 'Hades II', 'Silent Hill 2', 'Balatro'][r - 1]) })) },
  finished: { hasData: true, completed: { count: 12, items: [1, 2, 3, 4].map((i) => ({ at: '2026-10-05T18:42:11.000Z', game: game(i, `Игра ${i}`) })) }, dropped: { count: 3, items: [] }, busiestMonth: { month: 10, count: 4 } },
  trophies: { hasData: true, counts: { platinum: 7, gold: 31, silver: 88, bronze: 240, total: 366 }, platinum: { first: plat, last: plat, rarest: plat }, rare: [] },
  genres: { hasData: true, items: [{ key: 'A', label: 'Экшен', value: 14.5 }, { key: 'R', label: 'Ролевые', value: 6 }] },
  longestGame: { hasData: true, seconds: 1, hours: 53, estimated: false, playCount: 19, game: game(2, 'Final Fantasy VII Rebirth') },
  bestGame: { hasData: true, rating: 10, hours: 40, estimated: false, game: game(1, 'Astro Bot') },
};

/** Однотонный PNG 8x8 без файлов на диске. */
function png(r: number, g: number, b: number): Buffer {
  const crc = (buf: Buffer) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(8).fill([r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array(8).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
const COLORS = [[200, 60, 40], [40, 120, 200], [255, 255, 255], [60, 170, 90], [150, 60, 200]];

async function open(page: Page, context: BrowserContext, baseURL: string, reduced: boolean) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.route('https://image.api.playstation.com/**', (r) => { const n = Number(/c(\d)/.exec(r.request().url())![1]); const [a, b, c] = COLORS[n]; return r.fulfill({ status: 200, contentType: 'image/png', body: png(a, b, c) }); });
  await mockApi(page);
  await page.route(/\/api\/wrapped/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) }));
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/wrapped');
  await page.getByRole('button', { name: 'Смотреть итоги' }).click();
  await expect(page.locator('.ps-story__stage')).toBeFocused();
}
const stage = (page: Page) => page.locator('.ps-story__stage');
const slideVar = (page: Page) => stage(page).evaluate((el) => (el as HTMLElement).style.getPropertyValue('--slide-base'));

test('цвет слайда, мозаика на «Старте», размытая обложка на «Часах», финальная сводка', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, true);
  await expect(stage(page)).toHaveAttribute('data-slide', 'start');
  const c0 = await slideVar(page);
  await expect(page.locator('.ps-story__bg')).toHaveAttribute('data-art', 'mosaic');
  await expect(page.locator('.ps-story__mosaic span')).toHaveCount(4);
  await page.keyboard.press('ArrowRight');
  await expect(stage(page)).toHaveAttribute('data-slide', 'hours');
  expect(await slideVar(page)).not.toBe(c0);
  await expect(page.locator('.ps-story__bg')).toHaveAttribute('data-art', 'cover');
  // reduced-motion: число сразу итоговое, без «пружины»
  await expect(page.locator('.ps-story__big .ps-story__digits')).toHaveText('412,4');
  expect(await page.locator('.ps-story__big .ps-story__num').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  await expect(stage(page)).toHaveAttribute('data-slide', 'final');
  const sum = page.getByTestId('story-summary');
  await expect(sum).toBeVisible();
  await expect(sum.locator('.ps-sum__tiles li')).toHaveText(['412,4ч в играх', '12игр пройдено', '7платин', '366трофеев']);
  await expect(sum.locator('.ps-sum__gt')).toContainText('Игра года · ★ 10 из 10');
  await expect(sum.locator('.ps-sum__gt b')).toHaveText('Astro Bot');
  await expect(page.getByRole('heading', { name: `До встречи в ${Y + 1}` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Пересмотреть' })).toBeVisible();
  // контраст на слайдах с белой обложкой фоном и на финале
  await page.evaluate(createRequire(import.meta.url)('axe-core').source);
  const v = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } };
    const r = await w.axe.run({ include: [['.ps-story']], exclude: [['.ps-cover']] }, { runOnly: { type: 'rule', values: ['color-contrast'] } });
    return r.violations.map((x) => `${x.id}: ${x.nodes.length}`);
  });
  expect(v).toEqual([]);
});

test('без reduced-motion число считается от нуля и доходит до итога; ширина не прыгает', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, false);
  await page.keyboard.press('ArrowRight');
  const d = page.locator('.ps-story__big .ps-story__digits');
  const ow = () => d.evaluate((el) => (el as HTMLElement).offsetWidth); // без transform «пружины»
  const w0 = await ow();
  const early = await d.textContent();
  expect(early).not.toBe('412,4');
  await expect(d).toHaveText('412,4');
  expect(Math.abs((await ow()) - w0)).toBeLessThan(1);
  expect(await page.locator('.ps-story__big .ps-story__num').evaluate((el) => getComputedStyle(el).animationName)).toBe('ps-story-pop');
});

test('П8.5: видимая кнопка паузы держит слайд, листание не снимает паузу, P продолжает', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, false);
  const btn = page.getByTestId('story-pause');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAccessibleName('Пауза');
  const box = await btn.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(btn).toHaveAccessibleName('Продолжить');
  await expect(stage(page)).toHaveAttribute('data-paused', 'true');
  const fill = page.locator('.ps-story__seg[data-state="cur"] .ps-story__fill');
  const p = () => fill.evaluate((el) => Number((el as HTMLElement).style.getPropertyValue('--p')));
  const p0 = await p();
  await page.waitForTimeout(1200);
  expect(await p()).toBe(p0);
  await expect(stage(page)).toHaveAttribute('data-slide', 'start'); // нажатие на кнопку не листает
  await page.keyboard.press('ArrowRight');
  await expect(stage(page)).toHaveAttribute('data-slide', 'hours');
  await page.waitForTimeout(800);
  expect(await p()).toBe(0);
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('p');
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(p).toBeGreaterThan(0);
});

test('П8.5: при reduced-motion автоперехода нет, и кнопки паузы тоже', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, true);
  await expect(page.getByRole('button', { name: 'Закрыть итоги' })).toBeVisible();
  await expect(page.getByTestId('story-pause')).toHaveCount(0);
});
