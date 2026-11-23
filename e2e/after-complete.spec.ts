// Идея 3 (аудит UX): после «Пройдено» с карточки — лист: оценка и заметка, «что дальше» из Плана, «Начать» одним касанием.
import { createRequire } from 'node:module';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const entry = (gameId: number, title: string, hours: number) => ({
  key: `g:${gameId}`, kind: 'backlog', gameId, plannedId: null, title, coverUrl: null, hours, hoursSource: 'hltb', releaseDate: null, wantAtRelease: false,
  start: '2026-11-20', end: '2026-12-01', days: 12, segments: [],
});

async function open(page: Page, context: BrowserContext, baseURL: string, items: unknown[] | 'fail') {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const m = await mockApi(page);
  const statusPuts: { id: number; status: unknown }[] = [];
  page.on('request', (r) => {
    const mm = r.url().match(/\/api\/games\/(\d+)\/status$/);
    if (mm && r.method() === 'PUT') statusPuts.push({ id: Number(mm[1]), status: (r.postDataJSON() as { status: unknown }).status });
  });
  await page.route(/\/api\/roadmap$/, (r) => (items === 'fail'
    ? r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'db_unavailable', message: 'x' } }) })
    : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { items } }) })));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
  return { m, statusPuts };
}

const coll = (page: Page) => page.locator('section[aria-labelledby="coll-title"]');

async function complete(page: Page, title: string) {
  await coll(page).getByRole('button', { name: `Статус: ${title}` }).first().click();
  await page.getByRole('menuitemradio', { name: 'Пройдено' }).click();
}

test('«Пройдено» → лист: оценка сохраняется, «Начать» ставит следующей игре «Играю»', async ({ page, context, baseURL }) => {
  const { m, statusPuts } = await open(page, context, baseURL as string, [entry(8, 'Tetris Effect', 3), entry(6, 'Stray', 12.5)]);
  await complete(page, 'Tetris Effect');
  const sheet = page.getByRole('dialog', { name: 'Пройдено: Tetris Effect' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('game-review')).toBeVisible();
  const next = sheet.getByTestId('after-complete-next');
  await expect(next).toContainText('Stray');
  await expect(next).toContainText('осталось 13 ч');
  await page.evaluate(createRequire(import.meta.url)('axe-core').source as string);
  const v = await page.evaluate(async () => {
    const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await ax.run('[data-testid="after-complete"]', { resultTypes: ['violations'] });
    return r.violations.flatMap((x) => x.nodes.map((n) => `${x.id}: ${n.target.join(' ')}`));
  });
  expect(v).toEqual([]);

  const put = page.waitForRequest((r) => /\/api\/games\/8\/review$/.test(r.url()) && r.method() === 'PUT');
  await sheet.locator('.ps-rate__opt', { hasText: /^8$/ }).click();
  expect((await put).postDataJSON()).toMatchObject({ rating: 8 });
  await expect(sheet.getByText('Сохранено', { exact: true })).toBeVisible();
  expect(m.games.find((g) => g.id === 8)?.rating).toBe(8);

  await sheet.getByTestId('after-complete-start').click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText('«Stray»: Играю')).toBeVisible();
  expect(statusPuts.at(-1)).toEqual({ id: 6, status: 'playing' });
});

test('План не загрузился: блока «Что дальше» нет, «Готово» закрывает', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL as string, 'fail');
  await complete(page, 'Tetris Effect');
  const sheet = page.getByRole('dialog', { name: 'Пройдено: Tetris Effect' });
  await expect(sheet.getByTestId('game-review')).toBeVisible();
  await expect(sheet.getByTestId('after-complete-next')).toHaveCount(0);
  await sheet.getByTestId('after-complete-done').click();
  await expect(sheet).toHaveCount(0);
});

test('пустой План: подсказка выбрать в бэклоге; другой статус листа не открывает', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL as string, []);
  await page.goto('/?status=backlog');
  await coll(page).getByRole('button', { name: 'Статус: Stray' }).first().click();
  await page.getByRole('menuitemradio', { name: 'Брошено' }).click();
  await expect(page.getByText('Статус изменён: Брошено')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/');
  await complete(page, 'Tetris Effect');
  const sheet = page.getByRole('dialog', { name: 'Пройдено: Tetris Effect' });
  await expect(sheet.getByTestId('after-complete-next')).toContainText('В Плане нет следующей игры');
});
