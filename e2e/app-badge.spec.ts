// Идея 4 (аудит UX): бейдж на иконке PWA = число игр без статуса (как у «Разбора» в меню). Badging API и режим
// standalone подменены: проверяем, что приложение ставит и снимает число, а в браузерной вкладке не трогает API.
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

async function open(page: Page, context: BrowserContext, baseURL: string, standalone: boolean) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.addInitScript((sa: boolean) => {
    const w = window as unknown as { __badge: (number | null)[] };
    w.__badge = [];
    Object.assign(navigator, {
      setAppBadge: async (n: number) => { w.__badge.push(n); },
      clearAppBadge: async () => { w.__badge.push(null); },
    });
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => (q.includes('display-mode: standalone') ? { ...mm(q), matches: sa, media: q } as MediaQueryList : mm(q));
  }, standalone);
  const m = await mockApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
  return m;
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as { __badge: (number | null)[] }).__badge);

test('установленное приложение: на иконке число игр без статуса', async ({ page, context, baseURL }) => {
  const m = await open(page, context, baseURL as string, true);
  const none = m.games.filter((g) => !g.status && !g.hiddenAt).length;
  expect(none).toBeGreaterThan(0);
  await expect.poll(() => calls(page)).toEqual([none]);
});

test('вкладка браузера: Badging API не вызывается', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL as string, false);
  await page.waitForTimeout(800);
  expect(await calls(page)).toEqual([]);
});
