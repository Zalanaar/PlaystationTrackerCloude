// D-P1 (P1-3, пакет 2): на iPhone 13 (Safari, видимая область 664 px из 844) первая полная строка обложек Коллекции
// помещается в первый экран. Только проект webkit-iphone. API эмулируется (e2e/collection-mock.ts).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

/** Высота видимой области Safari на iPhone 13 с панелями (адресная строка + нижняя панель) */
const SAFARI_VISIBLE = 664;
const INBOX = { newGames: 3, newGamesWindow: '24h', newUnsorted: 2, trophies: 14, platinums: 1, trophiesWindow: '24h', hoursWeek: 12.5, hoursPrevWeek: 9.5, checkCount: 4, forgottenCount: 7, isEmpty: false };

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'webkit-iphone', 'первый экран iPhone: только WebKit'); });

async function open(page: Page, context: BrowserContext, baseURL: string, noPlaying: boolean) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const games = noPlaying ? seed().map((g) => (g.status === 'playing' ? { ...g, status: 'completed' as const, completedAt: '2026-10-01T10:00:00.000Z' } : g)) : seed();
  const m = await mockApi(page, games);
  // худший случай: полоса «С прошлого визита» и карточка профиля на месте
  m.inbox = INBOX;
  m.profile = { onlineId: 'Zalanaar26', avatarUrl: null, level: 327, levelProgress: 47, tier: 5, trophies: { platinum: 35, gold: 100, silver: 200, bronze: 500, total: 835 } };
  await page.addInitScript(() => localStorage.setItem('ps-wn-seen:1', '14'));
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
  await page.goto('/');
  await page.getByTestId('inbox-strip').waitFor();
}

test('«Играю» пусто: первая строка обложек целиком выше 664 px', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, true);
  const cover = page.locator('.ps-results .ps-card .ps-card__cover').first();
  await cover.waitFor();
  const b = (await cover.boundingBox())!;
  expect(b.y + b.height).toBeLessThanOrEqual(SAFARI_VISIBLE);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('есть «Играю»: hero начинается в первом экране', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, false);
  const hero = page.getByRole('region', { name: 'Играю' });
  await hero.waitFor();
  const b = (await hero.boundingBox())!;
  expect(b.y).toBeLessThan(SAFARI_VISIBLE - 40);
});
