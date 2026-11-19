// Идея 6 (аудит UX): экран «Мои оценки» — распределение, часы по оценкам, лучшие жанры, пройденные без оценки.
import { createRequire } from 'node:module';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mockApi, seed, type G } from './collection-mock';
import { signedSession } from './session';

function games(): G[] {
  const s = seed();
  const set = (id: number, o: Partial<G>) => Object.assign(s.find((g) => g.id === id) as G, o);
  set(1, { rating: 10, genres: ['RPG'] }); // Witcher 3, 100 ч
  set(2, { rating: 9, genres: ['RPG'] });
  set(4, { rating: 8, genres: ['ACTION'] });
  set(5, { rating: 0 }); // брошена, 0 — тоже оценка
  return s;
}

async function open(page: Page, context: BrowserContext, baseURL: string, list = games()) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, list);
  await page.goto('/ratings');
}

test('сводка, распределение, часы, жанры; без оценки — ссылка в окно игры', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL as string);
  await expect(page.getByTestId('ratings-summary')).toHaveText('Оценено 4 игры · средняя 6,8');
  const dist = page.getByTestId('ratings-dist').getByRole('listitem');
  await expect(dist).toHaveCount(11);
  await expect(dist.nth(0)).toHaveAttribute('aria-label', '0: 1 игра');
  await expect(dist.nth(10)).toHaveAttribute('aria-label', '10: 1 игра');
  await expect(page.getByTestId('ratings-hours').getByRole('row', { name: /9–10/ })).toContainText('2');
  await expect(page.getByTestId('ratings-genres')).toContainText('9,5 · 2 игры');
  // пройдено без оценки в seed: нет (1, 2, 4 оценены) — блока нет
  await expect(page.getByTestId('ratings-unrated')).toHaveCount(0);

  await page.evaluate(createRequire(import.meta.url)('axe-core').source as string);
  const v = await page.evaluate(async () => {
    const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await ax.run('[data-testid="ratings"]', { resultTypes: ['violations'] });
    return r.violations.flatMap((x) => x.nodes.map((n) => `${x.id}: ${n.target.join(' ')}`));
  });
  expect(v).toEqual([]);
});

test('пройдено без оценки: «Оценить» открывает окно игры', async ({ page, context, baseURL }) => {
  const list = games();
  (list.find((g) => g.id === 4) as G).rating = null;
  await open(page, context, baseURL as string, list);
  const un = page.getByTestId('ratings-unrated');
  await expect(un).toContainText('God of War');
  await un.getByRole('link', { name: 'Оценить' }).first().click();
  await expect(page).toHaveURL(/\/\?game=4$/);
  await expect(page.getByRole('dialog', { name: 'God of War' })).toBeVisible();
});

test('нет оценок: пустое состояние; пункт меню ведёт на экран', async ({ page, context, baseURL }, info) => {
  await open(page, context, baseURL as string, seed());
  await expect(page.getByText('Оценок пока нет')).toBeVisible();
  await page.goto('/stats');
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Меню', exact: true }).click();
    await page.getByTestId('sheet-ratings').click();
  } else {
    await page.locator('.ps-avatar').click();
    await page.getByTestId('menu-ratings').click();
  }
  await expect(page).toHaveURL(/\/ratings$/);
});
