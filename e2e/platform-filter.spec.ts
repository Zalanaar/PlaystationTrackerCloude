// F4: фильтр платформы в Коллекции и Бэклоге. PS5-игра с PS4-версией попадает в оба фильтра, одна PC-игра чипа не даёт,
// выбор запоминается (cookie ps-platform) и общий для обеих страниц. API эмулируется (e2e/collection-mock.ts).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G, type Mock } from './collection-mock';
import { signedSession } from './session';
import { isMobile } from './backlog-ui';

const g = (id: number, title: string, o: Partial<G> = {}): G => ({
  id, title, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 600, playCount: 1, trophies: null, ...o,
});
const games = (): G[] => [
  g(1, 'Оба Поколения', { platforms: ['ps5', 'ps4'] }),
  g(2, 'Только Пятёрка', { platforms: ['ps5'] }),
  g(3, 'Только Четвёрка', { platform: 'PS4', platforms: ['ps4'] }),
  g(4, 'Ещё Четвёрка', { platform: 'PS4', platforms: ['ps4'] }),
  g(5, 'Одна На ПК', { platforms: ['pc'] }),
];

async function open(page: Page, context: BrowserContext, baseURL: string, url: string): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, games());
  await page.goto(url);
  return mock;
}
const blTitles = async (page: Page) => (await page.locator('.ps-card:not(.ps-card--sk) .ps-card__title, .ps-row__title').allTextContents()).sort();

/** Выбор платформы в Коллекции: десктоп — select, мобильный — сегмент в sheet «Фильтры». */
async function pickCollection(page: Page, label: 'PS5' | 'PS4' | 'Все') {
  if (isMobile(page)) {
    await page.getByRole('button', { name: /^Фильтры и сортировка/ }).click();
    const seg = page.getByTestId('platform-seg');
    await expect(seg.getByRole('button')).toHaveText(['Все', 'PS5', 'PS4']);
    await seg.getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('button', { name: 'Готово' }).click();
  } else {
    const sel = page.getByTestId('platform-select');
    await expect(sel.locator('option')).toHaveText(['Все платформы', /^PS5.*2$/, /^PS4.*3$/]);
    await sel.selectOption(label === 'Все' ? '' : label.toLowerCase());
  }
}

test.describe('F4: фильтр платформы', () => {
  test('Бэклог: PS5+PS4 игра в обоих фильтрах, PC-чипа нет, выбор запоминается', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, '/backlog');
    await page.getByRole('heading', { name: 'Бэклог', level: 1 }).waitFor();
    await expect.poll(() => blTitles(page)).toHaveLength(5);
    if (isMobile(page)) await page.getByRole('button', { name: /^Фильтры и сортировка/ }).click();
    const chips = page.getByTestId('platform-chips');
    await expect(chips.getByRole('button')).toHaveCount(2);
    await expect(chips.locator('[data-platform="pc"]')).toHaveCount(0);
    await expect(chips.locator('[data-platform="ps5"]')).toContainText('2');
    await chips.locator('[data-platform="ps4"]').click();
    if (isMobile(page)) await page.keyboard.press('Escape');
    await expect.poll(() => blTitles(page)).toEqual(['Ещё Четвёрка', 'Оба Поколения', 'Только Четвёрка'].sort());
    await expect(page).toHaveURL(/platform=ps4/);
    expect(mock.listCalls.some((u) => u.searchParams.get('platform') === 'ps4')).toBe(true);
    expect((await context.cookies()).find((c) => c.name === 'ps-platform')?.value).toBe('ps4');
    if (isMobile(page)) await expect(page.getByTestId('platform-chip')).toHaveText(/PS4/);

    // запомнено: без параметра в URL первый запрос сразу с платформой
    await page.goto('/backlog');
    await expect.poll(() => blTitles(page)).toEqual(['Ещё Четвёрка', 'Оба Поколения', 'Только Четвёрка'].sort());
    // PS5: игра с PS4-версией тоже здесь
    if (isMobile(page)) await page.getByRole('button', { name: /^Фильтры и сортировка/ }).click();
    await page.getByTestId('platform-chips').locator('[data-platform="ps5"]').click();
    if (isMobile(page)) await page.keyboard.press('Escape');
    await expect.poll(() => blTitles(page)).toEqual(['Оба Поколения', 'Только Пятёрка'].sort());
  });

  test('Коллекция: выбор фильтрует ленту, общий с Бэклогом, «Все» снимает', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'ps-platform', value: 'ps5', url: baseURL! }]);
    const mock = await open(page, context, baseURL!, '/');
    await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeAttached();
    // запомненная PS5 из Бэклога/cookie: первый batch уже с ней
    await expect.poll(() => mock.listCalls.length).toBeGreaterThan(0);
    expect(mock.listCalls.every((u) => u.searchParams.get('platform') === 'ps5')).toBe(true);
    if (isMobile(page)) await expect(page.getByTestId('platform-chip')).toHaveText(/PS5/);
    else await expect(page.getByTestId('platform-select')).toHaveValue('ps5');
    const blk = page.getByRole('region', { name: 'Бэклог' });
    await expect(blk.locator('.ps-block__cnt').first()).toHaveText('2');
    await expect(page.locator('article.ps-card', { hasText: 'Четвёрка' })).toHaveCount(0);

    await pickCollection(page, 'PS4');
    await expect(blk.locator('.ps-block__cnt').first()).toHaveText('3');
    await expect(page.locator('article.ps-card', { hasText: 'Только Пятёрка' })).toHaveCount(0);
    expect(mock.listCalls.some((u) => u.searchParams.get('platform') === 'ps4')).toBe(true);
    expect((await context.cookies()).find((c) => c.name === 'ps-platform')?.value).toBe('ps4');

    if (isMobile(page)) await page.getByTestId('platform-chip').click();
    else await pickCollection(page, 'Все');
    await expect(blk.locator('.ps-block__cnt').first()).toHaveText('5');
    expect((await context.cookies()).find((c) => c.name === 'ps-platform')).toBeUndefined();
  });
});
