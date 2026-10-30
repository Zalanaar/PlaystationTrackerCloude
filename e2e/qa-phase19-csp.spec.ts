// QA Фазы 19: CSP не нарушается на экранах в авторизованном состоянии (в т.ч. PS5 с --page-art и http:// аватар).
// CSP_PROD=1 (прод-сборка, next start): аватар с http:// (legacy-строка БД) должен апгрейдиться через upgrade-insecure-requests; в dev апгрейда нет.
// Положительный контроль: заведомо запрещённый fetch на чужой origin должен дать нарушение, иначе слушатель слеп.
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const COVER = 'https://image.api.playstation.com/vulcan/cover.png';
const PAGES = ['/', '/stats', '/backlog', '/roadmap', '/recommend', '/wrapped', '/triage', '/?game=1', '/?game=1&tab=trophies'] as const;

function watch(page: Page) {
  const v: string[] = [];
  page.on('console', (m) => { if (/content security policy|violates the following|Refused to/i.test(m.text())) v.push(m.text().slice(0, 200)); });
  return v;
}

test('положительный контроль: нарушение CSP фиксируется', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await mockApi(page);
  const v = watch(page);
  await page.goto('/');
  await page.evaluate(() => fetch('https://example.invalid/x').catch(() => null));
  await page.waitForTimeout(300);
  expect(v.length).toBeGreaterThan(0);
});

for (const theme of ['night', 'ps5'] as const) {
  test(`без нарушений CSP на всех экранах, тема ${theme}, обложки и http:// аватар`, async ({ page, context, baseURL }) => {
    test.setTimeout(180_000);
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    const games = seed().map((g, i) => ({ ...g, coverUrl: COVER, bannerUrl: COVER, ...(i === 3 ? { status: 'playing' as const } : {}) }));
    const mock = await mockApi(page, games);
    mock.profile = { onlineId: 'Artem_PS', avatarUrl: `${process.env.CSP_PROD ? 'http' : 'https'}://static-resource.np.community.playstation.net/avatar/x.png`, level: 10, levelProgress: 5, tier: 2, trophies: { platinum: 1, gold: 2, silver: 3, bronze: 4, total: 10 } };
    await page.route(/image\.api\.playstation\.com|static-resource\.np\.community\.playstation\.net/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    const v = watch(page);
    const insecure: string[] = [];
    page.on('request', (r) => { if (r.url().startsWith('http://') && !r.url().startsWith(baseURL!)) insecure.push(r.url()); });
    for (const p of PAGES) {
      await page.goto(p);
      if (theme !== 'night') await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(400);
    }
    expect(v.join('\n'), 'нарушения CSP').toBe('');
    test.info().annotations.push({ type: 'http-запросы к внешним хостам', description: insecure.join(' | ') || 'нет' });
  });
}
