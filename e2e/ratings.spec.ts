// «Оценки» в Статистике: распределение, часы по оценкам, лучшие жанры, пройденные без оценки. /ratings → /stats?sec=ratings.
import { createRequire } from 'node:module';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mockApi, seed, type G } from './collection-mock';
import { signedSession } from './session';
import { respond } from './stats-mock';

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
  await page.route(/\/api\/stats\?/, (r) => {
    const u = new URL(r.request().url());
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: respond(u) }) });
  });
  await page.goto('/ratings');
  await expect(page).toHaveURL(/\/stats\?sec=ratings/);
  await expect(page.getByTestId('ratings')).toBeVisible();
}

test('сводка, распределение, часы, жанры; без оценки блок скрыт', async ({ page, context, baseURL }) => {
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

test('пройдено без оценки: «Оценить» открывает лист на Статистике, оценка остаётся здесь', async ({ page, context, baseURL }) => {
  const list = games();
  (list.find((g) => g.id === 4) as G).rating = null;
  await open(page, context, baseURL as string, list);

  // как в жизни: Коллекция → таб «Статистика» → «Оценки» (вкладка не должна залипать на Статистике после оценки)
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.goto('/');
    await page.locator('nav.ps-tabbar').getByRole('link', { name: /Статистика/ }).click();
    await expect(page).toHaveURL(/\/stats/);
    await expect(page.getByTestId('stats-sections').getByRole('button', { name: 'Часы' })).toBeVisible();
    await page.getByTestId('stats-sections').locator('[data-sec="ratings"]').click();
    await expect(page.getByTestId('ratings')).toBeVisible();
  }

  const un = page.getByTestId('ratings-unrated');
  await expect(un).toContainText('God of War');
  await un.getByRole('button', { name: 'Оценить' }).first().click();
  await expect(page).toHaveURL(/\/stats/);
  await expect(page).not.toHaveURL(/[?&]game=/);
  const sheet = page.getByRole('dialog', { name: 'God of War' });
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('ratings-rate-sheet')).toBeVisible();
  await expect(page.getByTestId('game-review')).toBeVisible();
  await sheet.getByRole('radio', { name: '8' }).click();
  await expect(sheet.getByTestId('review-value')).toContainText('8');
  await expect(sheet.getByText('Сохранено')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/\/stats/);
  await expect(page).not.toHaveURL(/[?&]game=/);
  await expect(page.getByTestId('ratings-unrated')).toHaveCount(0);
  await expect(page.getByTestId('ratings-summary')).toHaveText('Оценено 4 игры · средняя 6,8');
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    const tabs = page.locator('nav.ps-tabbar');
    await expect(tabs.getByRole('link', { name: /Статистика/ })).toHaveAttribute('aria-current', 'page');
    await expect(tabs.getByRole('link', { name: /Коллекция/ })).not.toHaveAttribute('aria-current');
  } else {
    await expect(page.locator('header nav[aria-label="Разделы"]').getByRole('link', { name: /Статистика/ })).toHaveAttribute('aria-current', 'page');
  }
});

test('нет оценок: пустое состояние; в меню пункта нет, чип «Оценки» в Статистике', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL as string, seed());
  await expect(page.getByText('Оценок пока нет')).toBeVisible();
  await page.goto('/stats');
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.getByRole('button', { name: 'Меню', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Меню' });
    await expect(sheet.getByRole('link', { name: 'Мои оценки' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  } else {
    await page.locator('.ps-avatar').click();
    await expect(page.getByTestId('menu-ratings')).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Мои оценки' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
  const chip = page.getByTestId('stats-sections').locator('[data-sec="ratings"]');
  await expect(chip).toHaveText('Оценки');
  await chip.click();
  await expect(page.getByTestId('ratings').getByRole('heading', { name: 'Оценки', exact: true })).toBeVisible();
});
