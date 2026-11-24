// t276u: шит «Добавить игру в план» — сразу «Ищу…», пустой результат, ручной ввод, скролл не уходит на фон.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { baseState, mockRoadmap } from './roadmap-mock';
import { signedSession } from './session';

async function openSheet(page: Page, context: BrowserContext, baseURL: string, over: Parameters<typeof baseState>[0] = {}) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, []);
  await mockRoadmap(page, baseState(over));
  await page.goto('/roadmap');
  await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
  await page.getByRole('button', { name: 'Добавить игру' }).click();
  const dlg = page.getByRole('dialog', { name: 'Добавить игру в план' });
  await expect(dlg).toBeVisible();
  return dlg;
}

test.describe('шит «Добавить игру в план»', () => {
  test('при вводе сразу «Ищу…» и скелет, не дожидаясь ответа каталога', async ({ page, context, baseURL }) => {
    const dlg = await openSheet(page, context, baseURL as string, {
      catalogDelayMs: 2500,
      catalog: { status: 200, candidates: [{ externalSource: 'rawg', externalId: '1', title: 'The Last of Us', releaseDate: '2026-12-01', coverUrl: null, platforms: ['PlayStation 5'], playstation: true }] },
    });
    await dlg.getByLabel('Найти в каталоге').fill('Last of');
    await expect(dlg.getByTestId('rm-catalog-loading')).toBeVisible({ timeout: 500 });
    await expect(dlg.locator('.ps-rm-cand--sk')).toHaveCount(3);
    await expect(dlg.getByRole('button', { name: /The Last of Us/ })).toBeVisible({ timeout: 4000 });
    await expect(dlg.getByTestId('rm-catalog-loading')).toHaveCount(0);
  });

  test('пусто: «Ничего не нашлось», кнопка подставляет название и фокусирует ручную форму', async ({ page, context, baseURL }) => {
    const dlg = await openSheet(page, context, baseURL as string, { catalog: { status: 200, candidates: [] } });
    await dlg.getByRole('button', { name: 'Только PlayStation' }).click();
    await dlg.getByLabel('Найти в каталоге').fill('zzzz-game');
    await expect(dlg.getByTestId('rm-catalog-empty')).toContainText('Ничего не нашлось — добавь вручную');
    await dlg.getByTestId('rm-catalog-empty-add').click();
    await expect(dlg.getByLabel('Название')).toHaveValue('zzzz-game');
    await expect(dlg.getByLabel('Название')).toBeFocused();
  });

  test('после очистки поиска шит сам скроллится, страница под ним заблокирована', async ({ page, context, baseURL, isMobile }) => {
    const dlg = await openSheet(page, context, baseURL as string, { catalog: { status: 200, candidates: [] } });
    await expect(page.locator('body')).toHaveAttribute('data-scroll-lock', '1');
    expect(await page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed');

    await dlg.getByLabel('Найти в каталоге').fill('Last of');
    await expect(dlg.getByTestId('rm-catalog-empty').or(dlg.getByTestId('rm-catalog-loading'))).toBeVisible();
    await dlg.getByLabel('Найти в каталоге').fill('');
    await expect(dlg.getByText('Начни вводить название')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-scroll-lock', '1');
    expect(await page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed');

    await dlg.getByTestId('rm-manual-open').click();
    const moved = await page.evaluate(() => {
      const sc = document.querySelector('.ps-sheet__body') as HTMLElement | null;
      if (!sc) return { ok: false, y: 0, h: 0, c: 0 };
      sc.scrollTop = 120;
      return { ok: true, y: sc.scrollTop, h: sc.scrollHeight, c: sc.clientHeight };
    });
    expect(moved.ok).toBe(true);
    expect(moved.h).toBeGreaterThan(moved.c - 1);
    expect(moved.y).toBeGreaterThan(20);
    expect(await page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed');

    if (isMobile) {
      const foot = page.locator('.ps-sheet__foot');
      await expect(foot.getByRole('button', { name: 'Добавить в план' })).toBeVisible();
      await expect(foot.getByRole('button', { name: 'Отмена' })).toBeVisible();
    }
  });
});
