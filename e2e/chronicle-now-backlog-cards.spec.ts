// Фаза 22, часть A: блок «Сейчас» в Хронике (1.2), выравнивание кнопок карточек Бэклога (1.3), статус синка в мобильной шапке.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { signedSession } from './session';

const g = (id: number, title: string, o: Partial<G> = {}): G => ({
  id, title, lastPlayedAt: null, status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null, ...o,
});

async function open(page: Page, context: BrowserContext, baseURL: string, games: G[], url: string, heading: string): Promise<void> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, games);
  await page.goto(url);
  await page.getByRole('heading', { name: heading, level: 1 }).waitFor();
  await page.locator('.ps-card:not(.ps-card--sk), .ps-empty').first().waitFor();
}

test.describe('Хроника: блок «Сейчас»', () => {
  const games = (): G[] => [
    g(1, 'Играю Раз', { status: 'playing', lastPlayedAt: '2026-10-30T10:00:00.000Z', playSeconds: 3600 }),
    g(2, 'Играю Два', { status: 'playing', lastPlayedAt: '2026-10-20T10:00:00.000Z', playSeconds: 7200 }),
    g(3, 'Пройдена', { status: 'completed', completedAt: '2026-10-10T10:00:00.000Z', lastPlayedAt: '2026-10-10T10:00:00.000Z' }),
  ];

  test('первым блоком, до годов; игра из hero видна и в блоке', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, games(), '/', 'Коллекция');
    const now = page.getByTestId('now-block');
    await expect(now.getByRole('heading', { name: 'Сейчас' })).toBeVisible();
    await expect(now.locator('.ps-card__title')).toHaveText(['Играю Раз', 'Играю Два']);
    await expect(page.locator('.ps-hero')).toContainText('Играю Раз');
    const nowY = (await now.boundingBox())?.y ?? 0;
    const yearY = (await page.locator('.ps-chron').first().boundingBox())?.y ?? 0;
    expect(nowY).toBeLessThan(yearY);
  });

  test('нет игр в статусе «Играю»: блока нет', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, games().filter((x) => x.status !== 'playing'), '/', 'Коллекция');
    await expect(page.getByTestId('now-block')).toHaveCount(0);
    await expect(page.locator('.ps-chron').first()).toBeVisible();
  });
});

test.describe('Бэклог: кнопки карточек на одной линии', () => {
  const games = (): G[] => [
    g(1, 'Короткая', { hltbHours: 8, hltbName: 'Short' }),
    g(2, 'Очень длинное название игры которое точно не уместится в две строки карточки бэклога', { hltbHours: 12 }),
    g(3, 'Без часов'),
    g(4, 'Ещё одна игра с часами', { hltbHours: 30, hltbName: 'More' }),
    g(5, 'Пятая', { override: 25 }),
    g(6, 'Шестая без часов с длинным названием из нескольких слов подряд'),
  ];

  for (const vp of [{ name: 'десктоп', width: 1280, height: 900 }, { name: 'мобильный', width: 390, height: 844 }]) {
    test(`одинаковый y кнопок в ряду: ${vp.name}`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await open(page, context, baseURL as string, games(), '/backlog', 'Бэклог');
      const rows = await page.locator('.ps-bl-list .ps-grid > li').evaluateAll((lis) => {
        const byTop = new Map<number, number[]>();
        for (const li of lis) {
          const top = Math.round(li.getBoundingClientRect().top);
          const btn = li.querySelector('.ps-bl-actions .ps-btn');
          if (!btn) continue;
          byTop.set(top, [...(byTop.get(top) ?? []), Math.round(btn.getBoundingClientRect().top)]);
        }
        return [...byTop.values()];
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((r) => r.length > 1)).toBe(true);
      for (const ys of rows) expect(new Set(ys).size).toBe(1);
      await expect(page.getByTestId('bl-duration')).toHaveCount(6);
    });
  }
});

test('мобильная шапка: статус синка текстом', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, context, baseURL as string, [g(1, 'Игра')], '/backlog', 'Бэклог');
  const t = page.locator('.ps-btn--sync .ps-sync-text-m');
  await expect(t).toBeVisible();
  await expect(t).toContainText(/Синк|Ошибка/);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(t).toBeHidden();
  await expect(page.locator('.ps-btn--sync .ps-sync-text')).toBeVisible();
});

for (const w of [320, 360, 390]) {
  test(`мобильная шапка: кнопка «Меню» целиком в экране при ${w} px`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: w, height: 800 });
    await open(page, context, baseURL as string, [g(1, 'Игра')], '/backlog', 'Бэклог');
    const box = await page.getByRole('button', { name: 'Меню', exact: true }).first().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(w);
    const doc = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(doc).toBeLessThanOrEqual(w);
  });
}
