// Фаза 22, часть B: блок «Отложено» в Бэклоге, липкая плашка .ps-bl-jump (11.3-11.5 design-system).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { signedSession } from './session';

const g = (id: number, title: string, o: Partial<G> = {}): G => ({
  id, title, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 600, playCount: 1, trophies: null, ...o,
});

const games = (backlog = 3, shelved = 2): G[] => [
  ...Array.from({ length: backlog }, (_, i) => g(i + 1, `Бэклог ${i + 1}`)),
  ...Array.from({ length: shelved }, (_, i) => g(100 + i, `Отложена ${i + 1}`, { status: 'shelved' })),
];

async function open(page: Page, context: BrowserContext, baseURL: string, list: G[]): Promise<void> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, list);
  await page.goto('/backlog');
  await page.getByRole('heading', { name: 'Бэклог', level: 1 }).waitFor();
  await page.locator('.ps-card:not(.ps-card--sk), .ps-empty').first().waitFor();
}

const shelved = (page: Page) => page.getByTestId('bl-shelved');
const jump = (page: Page) => page.getByTestId('bl-jump');
const tab = (page: Page, name: string) => jump(page).getByRole('button', { name: new RegExp(`^${name}`) });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('Бэклог: блок «Отложено»', () => {
  test('блок между бэклогом и сервисом, счётчик в заголовке и во вкладке, подзаголовок', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, [...games(), g(200, 'Сервис 1', { status: 'service' })]);
    await expect(shelved(page).getByRole('heading', { name: /Отложено/ })).toBeVisible();
    await expect(page.getByTestId('bl-shelved-count')).toHaveText('2');
    await expect(shelved(page).locator('.ps-card__title')).toHaveText(['Отложена 1', 'Отложена 2']);
    await expect(shelved(page)).toContainText('Отложено на потом. В бэклог и план эти игры не входят.');
    await expect(tab(page, 'Отложено')).toContainText('2');
    await expect(jump(page).getByRole('button')).toHaveText([/^Бэклог 3/, /^Отложено 2/, /^Сервис 1/]);
    const y = async (sel: string) => (await page.locator(sel).boundingBox())?.y ?? 0;
    expect(await y('#h-bl-main')).toBeLessThan(await y('#h-bl-shelved'));
    expect(await y('#h-bl-shelved')).toBeLessThan(await y('#h-bl-service'));
    await expect(page.locator('[data-tour="backlog-list"]')).toHaveCount(1);
    await expect(page.locator('[data-tour="backlog-list"] .ps-card__title')).not.toContainText(['Отложена 1']);
  });

  test('нет отложенных: блока и плашки нет', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, games(3, 0));
    await expect(shelved(page)).toHaveCount(0);
    await expect(jump(page)).toHaveCount(0);
  });

  test('«Вернуть в бэклог»: игра переезжает, счётчики совпадают, последняя оставляет пустое состояние и вкладку', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, games(2, 1));
    await shelved(page).getByRole('button', { name: 'Вернуть в бэклог' }).click();
    await expect(page.getByTestId('bl-main-count')).toHaveText('3');
    await expect(page.getByTestId('bl-shelved-count')).toHaveText('0');
    await expect(shelved(page).getByRole('heading', { name: 'Отложенных игр нет' })).toBeVisible();
    await expect(tab(page, 'Отложено')).toContainText('0');
    await expect(tab(page, 'Бэклог')).toContainText('3');
    await expect(page.locator('[data-tour="backlog-list"] .ps-card__title')).toContainText(['Отложена 1']);
  });

  test('«Начать играть»: игра уходит из блока, в бэклог не попадает', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, games(2, 2));
    await shelved(page).getByRole('button', { name: 'Начать играть' }).first().click();
    await expect(page.getByTestId('bl-shelved-count')).toHaveText('1');
    await expect(tab(page, 'Отложено')).toContainText('1');
    await expect(page.getByTestId('bl-main-count')).toHaveText('2');
    await expect(page.getByText('Статус изменён: Играю')).toBeVisible();
  });

  test('«Свернуть» прячет сетку', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, games());
    const btn = shelved(page).getByRole('button', { name: 'Свернуть' });
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await btn.click();
    await expect(shelved(page).locator('.ps-card')).toHaveCount(0);
    await expect(shelved(page).getByRole('button', { name: 'Развернуть' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('кнопки в карточках отложенных на одной линии', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, [g(1, 'Б'), g(100, 'Короткая', { status: 'shelved' }), g(101, 'Очень длинное название отложенной игры которое займёт две строки карточки', { status: 'shelved' })]);
    const ys = await shelved(page).getByRole('button', { name: 'Вернуть в бэклог' }).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(ys).size).toBe(1);
  });
});

test.describe('Бэклог: липкая плашка', () => {
  test('360 px: нет горизонтального скролла, 3 вкладки в одну строку высотой 44', async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await open(page, context, baseURL as string, [...games(), g(200, 'Сервис 1', { status: 'service' })]);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    const boxes = await jump(page).getByRole('button').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height) }; }));
    expect(boxes).toHaveLength(3);
    expect(new Set(boxes.map((b) => b.top)).size).toBe(1);
    expect(boxes[0].h).toBe(44);
  });

  test('сплошной фон, без рамки у вкладок, тень только при data-stuck', async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await open(page, context, baseURL as string, games(24, 2));
    await expect(jump(page)).toHaveAttribute('data-stuck', 'false');
    const st = await page.evaluate(() => {
      const n = document.querySelector('[data-testid="bl-jump"]') as HTMLElement;
      const t = document.querySelector('.ps-bl-jump__tab') as HTMLElement;
      const c = getComputedStyle(n);
      return { bg: c.backgroundColor, shadow: c.boxShadow, border: getComputedStyle(t).borderTopWidth, trayBorder: getComputedStyle(document.querySelector('.ps-bl-jump__tabs') as HTMLElement).borderTopWidth };
    });
    expect(st.bg).toMatch(/^(rgba|color)\(/); // полупрозрачный фон + blur (матовое стекло, решение Артёма 2026-10-31)
    expect(st.border).toBe('0px');
    expect(st.trayBorder).toBe('0px');
    expect(st.shadow === 'none' || /0px 0px 0px/.test(st.shadow)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 700));
    await expect(jump(page)).toHaveAttribute('data-stuck', 'true');
    await expect.poll(() => jump(page).evaluate((e) => getComputedStyle(e).boxShadow)).not.toMatch(/^rgba?\(0, 0, 0, 0\) 0px 0px 0px/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(jump(page)).toHaveAttribute('data-stuck', 'false');
  });

  test('aria-current по прокрутке и клик по вкладке', async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await open(page, context, baseURL as string, games(24, 2));
    await expect(tab(page, 'Бэклог')).toHaveAttribute('aria-current', 'location');
    await tab(page, 'Отложено').click();
    await expect(tab(page, 'Отложено')).toHaveAttribute('aria-current', 'location');
    await expect(tab(page, 'Бэклог')).not.toHaveAttribute('aria-current', 'location');
    await expect(page.locator('#h-bl-shelved')).toBeFocused();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(tab(page, 'Бэклог')).toHaveAttribute('aria-current', 'location');
  });
});
