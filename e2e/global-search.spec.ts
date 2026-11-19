// Идея 2 (аудит UX): поиск игры из любого раздела. В Статистике кнопка «Найти игру» шапки открывает лист, ищет по
// коллекции (GET /api/games?q=) и ведёт в окно игры на Коллекции.
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';
import { searchBox } from './header-actions';
import { open } from './stats-mock';

test('Статистика → «Найти игру» → результат → окно игры', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL as string);
  const btn = page.getByTestId('hdr-search').filter({ visible: true });
  await expect(btn).toHaveCount(1);
  await btn.click();
  const sheet = page.getByRole('dialog', { name: 'Найти игру' });
  await expect(sheet).toBeVisible();
  const input = sheet.getByRole('searchbox', { name: 'Название игры в коллекции' });
  await expect(input).toBeFocused();
  await expect(sheet.getByText('Минимум 2 буквы', { exact: false })).toBeVisible();

  await input.fill('zzzz');
  await expect(sheet.getByTestId('global-search-empty')).toBeVisible();

  await input.fill('witcher');
  const rows = sheet.getByTestId('global-search-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('The Witcher 3: Wild Hunt');
  await expect(rows.first()).toContainText('Пройдено');

  await page.evaluate(createRequire(import.meta.url)('axe-core').source as string);
  const v = await page.evaluate(async () => {
    const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await ax.run('[data-testid="global-search"]', { resultTypes: ['violations'] });
    return r.violations.flatMap((x) => x.nodes.map((n) => `${x.id}: ${n.target.join(' ')}`));
  });
  expect(v).toEqual([]);

  await rows.first().click();
  await expect(page).toHaveURL(/\/\?game=1$/);
  await expect(page.getByRole('dialog', { name: 'The Witcher 3: Wild Hunt' })).toBeVisible();
  await expect(sheet).toHaveCount(0);
});

test('на Коллекции кнопка шапки по-прежнему открывает поиск списка', async ({ page, context, baseURL }, info) => {
  test.skip(info.project.name === 'desktop', 'на десктопе поле поиска списка видно сразу');
  await open(page, context, baseURL as string, '/');
  await expect(page.locator('.ps-card').first()).toBeVisible();
  await searchBox(page);
  await expect(page.getByRole('dialog', { name: 'Найти игру' })).toHaveCount(0);
});
