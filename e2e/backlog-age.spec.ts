// П12.4: «Возраст бэклога» — строка под заголовком «Бэклог» (медиана, дольше года, самая старая) и подпись в строках вида «Список».
// Приходит вместе со списком (без сдвига), под фильтрами строки нет, пустой ответ = ничего; 360 px без скролла, axe во всех темах.
import { createRequire } from 'node:module';
import { test, expect, type Page } from '@playwright/test';
import { mockApi, type G, type Mock } from './collection-mock';
import { signedSession } from './session';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

const bl = (id: number, title: string): G => ({
  id, title, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null, genres: ['ACTION'],
});
const AGE = {
  items: [
    { gameId: 1, since: ago(200), source: 'status' },
    { gameId: 2, since: ago(800), source: 'played' },
    { gameId: 3, since: ago(20), source: 'status' },
  ],
  summary: { count: 3, medianDays: 200, overYear: 1, oldest: { gameId: 2, title: 'Браво Старая игра', since: ago(800) } },
};

async function open(page: Page, baseURL: string, age: Record<string, unknown> | null = AGE, url = '/backlog'): Promise<Mock> {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
  const mock = await mockApi(page, [bl(1, 'Альфа Экшен'), bl(2, 'Браво Старая игра'), bl(3, 'Чарли Свежая')]);
  if (age) mock.backlogAge = age;
  await page.goto(url);
  await page.locator('.ps-blrow, .ps-card:not(.ps-card--sk), .ps-empty').first().waitFor();
  return mock;
}
const rows = (page: Page) => page.locator('.ps-bl-list .ps-blrow');
// вид из storageState проекта может быть «Карточки»: переключаем на «Список»
async function listView(page: Page) {
  const btn = page.getByRole('button', { name: 'Список', exact: true }).first();
  if ((await rows(page).count()) === 0) await btn.click();
}

test('строка возраста под заголовком и подписи строк', async ({ page, baseURL }) => {
  await open(page, baseURL!);
  await listView(page);
  await expect(rows(page)).toHaveCount(3);
  const line = page.getByTestId('bl-age');
  await expect(line).toHaveText('Половина игр ждёт дольше 6 мес. · дольше года — 1 · дольше всех — Браво Старая игра, 2 г. 2 мес.');
  await expect(line).toHaveAttribute('title', /первого запуска/);
  const age = (t: string) => rows(page).filter({ hasText: t }).getByTestId('bl-row-age');
  await expect(age('Альфа')).toHaveText('В бэклоге 6 мес.');
  await expect(age('Браво')).toHaveText('Начата 2 г. 2 мес. назад');
  await expect(age('Чарли')).toHaveText('В бэклоге 2 нед.');
});

test('под фильтром строки нет, подписи строк остаются', async ({ page, baseURL }) => {
  await open(page, baseURL!, AGE, '/backlog?q=%D0%90%D0%BB%D1%8C%D1%84%D0%B0');
  await listView(page);
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId('bl-age')).toHaveCount(0);
  await expect(rows(page).getByTestId('bl-row-age')).toHaveText('В бэклоге 6 мес.');
});

test('пустой ответ: ни строки, ни подписей', async ({ page, baseURL }) => {
  await open(page, baseURL!, null);
  await listView(page);
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByTestId('bl-age')).toHaveCount(0);
  await expect(page.getByTestId('bl-row-age')).toHaveCount(0);
});

test('сбой запроса возраста не ломает страницу', async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
  await mockApi(page, [bl(1, 'Альфа Экшен')]);
  await page.route(/\/api\/collection\/backlog-age(\?|$)/, (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'db_unavailable', message: 'x' } }) }));
  await page.goto('/backlog');
  await expect(page.locator('.ps-blrow, .ps-card:not(.ps-card--sk)').first()).toBeVisible();
  await expect(page.getByTestId('bl-age')).toHaveCount(0);
});

for (const w of [360, 390]) {
  test(`${w} px: без горизонтального скролла, axe во всех темах`, async ({ page, baseURL, isMobile: mobile }) => {
    test.skip(!mobile, 'телефон');
    await page.setViewportSize({ width: w, height: 800 });
    await open(page, baseURL!);
    await expect(page.getByTestId('bl-age')).toBeVisible();
    await listView(page);
    await expect(rows(page)).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.evaluate(axeSource);
    for (const t of THEMES) {
      await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
      await page.waitForTimeout(300);
      const v = await page.evaluate(async () => {
        const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
        const r = await ax.run({ include: [['[data-testid="bl-age"]'], ['.ps-bl-rows']] }, { resultTypes: ['violations'] });
        return r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      });
      expect(v, t).toEqual([]);
    }
  });
}
