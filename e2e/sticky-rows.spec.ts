// Пакет 5 (t159u): липкие ряды под шапкой на мобильном и в PWA — сегменты Бэклога (.ps-bl-jump) и чипы месяцев Хроники (.ps-mchips).
// Mobile (Pixel 7) и WebKit iPhone; на десктопе тоже липкие. API эмулируется (e2e/collection-mock.ts).
import { test, expect, type BrowserContext, type Page, type Locator } from '@playwright/test';
import { mockApi, seed, type G } from './collection-mock';
import { signedSession } from './session';

const done = (id: number, month: number, day: number): G => ({
  id, title: `Пройдена ${id}`, lastPlayedAt: new Date(Date.UTC(2026, month, day, 10)).toISOString(), status: 'completed',
  completedAt: new Date(Date.UTC(2026, month, day, 10)).toISOString(), droppedAt: null, playSeconds: 3600 * 5, playCount: 3, trophies: null,
});
const chronicle = (): G[] => [...seed(), ...Array.from({ length: 36 }, (_, i) => done(500 + i, 9 - Math.floor(i / 6), 20 - (i % 6)))];
const backlog = (): G[] => [
  ...Array.from({ length: 40 }, (_, i): G => ({
    id: 700 + i, title: `Бэклог ${i + 1}`, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 600, playCount: 1, trophies: null,
  })),
  ...Array.from({ length: 3 }, (_, i): G => ({
    id: 800 + i, title: `Сервис ${i + 1}`, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'service', completedAt: null, droppedAt: null, playSeconds: 600, playCount: 1, trophies: null,
  })),
];

async function login(page: Page, context: BrowserContext, baseURL: string, games: G[]) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  return mockApi(page, games);
}

/** Ряд прилип к низу шапки, непрозрачен и сверху: в точке его центра — он сам, а не карточка под ним. */
async function stuckUnderHeader(page: Page, row: Locator) {
  await expect.poll(async () => row.evaluate((el) => {
    const h = document.querySelector('.ps-header')!.getBoundingClientRect().bottom;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 40), r.top + r.height / 2);
    return Math.abs(r.top - h) <= 2 && !!hit && el.contains(hit);
  })).toBe(true);
  // фон сплошной: альфа 1 (rgb(...) без альфы), без стекла
  const bg = await row.evaluate((el) => ({ c: getComputedStyle(el).backgroundColor, f: getComputedStyle(el).backdropFilter || 'none' }));
  expect(bg.c).toMatch(/^rgb\(/);
  expect(bg.f).toBe('none');
}

test.describe('липкие ряды', () => {
  test('Бэклог: ряд «Бэклог / Сервис» остаётся под шапкой после прокрутки, вкладка ведёт к блоку не под ряд', async ({ page, context, baseURL }) => {
    await login(page, context, baseURL!, backlog());
    await page.goto('/backlog');
    const jump = page.getByTestId('bl-jump');
    await expect(jump.getByRole('button')).toHaveText([/^Бэклог 40/, /^Сервис 3/]);
    await page.evaluate(() => window.scrollBy(0, 1500));
    await stuckUnderHeader(page, jump);
    await expect(jump).toHaveAttribute('data-stuck', 'true');
    await jump.getByRole('button', { name: /^Сервис/ }).click();
    await expect(jump.getByRole('button', { name: /^Сервис/ })).toHaveAttribute('aria-current', 'location');
    await expect.poll(async () => page.evaluate(() => {
      const nav = document.querySelector('[data-testid="bl-jump"]')!.getBoundingClientRect().bottom;
      const t = document.getElementById('h-bl-service')!.getBoundingClientRect().top;
      return t >= nav - 1;   // заголовок блока не уходит под липкий ряд
    })).toBe(true);
    // наверху ряд снова в потоке, не «прилип»
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect(jump).toHaveAttribute('data-stuck', 'false');
  });

  test('Коллекция: чипы месяцев года под шапкой после прокрутки, активный следует за прокруткой, чип ведёт к месяцу', async ({ page, context, baseURL }) => {
    await login(page, context, baseURL!, chronicle());
    await page.goto('/');
    const chips = page.getByRole('navigation', { name: 'Месяцы 2026' });
    await expect(chips.getByRole('button').first()).toBeVisible();
    await expect(chips.locator('[aria-current="true"]')).toHaveText(/^Окт/);
    // прокрутка к августу: полоса под шапкой, активный чип «Авг»
    await page.evaluate(() => window.scrollTo(0, window.scrollY + document.getElementById('m2026-08')!.getBoundingClientRect().top - 100));
    await stuckUnderHeader(page, chips);
    await expect(chips.locator('[aria-current="true"]')).toHaveText(/^Авг/);
    // чип «Май»: первая карточка месяца сразу под полосой, не под ней
    const may = chips.getByRole('button', { name: /^Май/ });
    await may.click();
    await expect(may).toHaveAttribute('aria-current', 'true');
    await expect.poll(async () => page.evaluate(() => {
      const nav = document.querySelector('.ps-chron > .ps-mchips')!.getBoundingClientRect().bottom;
      const t = document.getElementById('m2026-05')!.getBoundingClientRect().top;
      return t >= nav - 1 && t < nav + 40;
    })).toBe(true);
    await expect(page.locator('#m2026-05')).toBeFocused();
  });
});
