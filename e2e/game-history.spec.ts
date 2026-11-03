// Фаза 34: «История игры» и свёрнутая «Длительность прохождения» в окне игры (мок-API, контракт api-contract §26).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { signedSession } from './session';

const g = (id: number, title: string, o: Partial<G> = {}): G => ({
  id, title, lastPlayedAt: '2026-06-06T10:00:00.000Z', status: 'playing', completedAt: null, droppedAt: null,
  playSeconds: 36_000, playCount: 5, trophies: null, ...o,
});

const week = (weekStart: string, seconds = 0, estimatedSeconds = 0, trophies = 0, platinum = false) => ({ weekStart, seconds, estimatedSeconds, trophies, platinum });
const history = {
  weeks: [week('2026-05-04', 7200, 3600), week('2026-05-11', 3600, 1800), week('2026-05-18', 10_800), week('2026-05-25'), week('2026-06-01', 1800, 0, 2, true)],
  truncated: false, hasHours: true, hasEstimate: true, playedDays: 14, firstSnapshotDate: '2026-05-12',
};

async function open(page: Page, context: BrowserContext, baseURL: string, setup: (m: Awaited<ReturnType<typeof mockApi>>) => void, id = 1) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, [g(1, 'Stray'), g(2, 'Без снимков', { trophies: null }), g(3, 'Старый ответ')]);
  setup(mock);
  await page.goto(`/?game=${id}`);
  return mock;
}

test('история: строка, график с оценкой штриховкой, трофеи и платина на одной шкале', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL as string, (m) => { m.histories[1] = history; });
  const dlg = page.getByRole('dialog', { name: 'Stray' });
  const block = dlg.getByTestId('game-history');
  await expect(block.getByRole('heading', { name: 'История игры' })).toBeVisible();
  await expect(block.getByTestId('history-line')).toHaveText('Играл 14 дней, последний раз 6 июн.');
  await expect(block.getByRole('img')).toHaveAttribute('aria-label', /5 недель.*больше всего 3 ч на неделе с 18 мая.*платина получена на неделе с 1 июн\./);
  // оценка помечена штриховкой и словом «оценка» в легенде
  await expect(block.getByTestId('history-est')).toHaveCount(2);
  const legend = block.getByRole('list', { name: 'Обозначения графика' });
  await expect(legend).toContainText('оценка до первого синка');
  await expect(legend).toContainText('платина');
  await expect(legend).toContainText('трофеи');
  await expect(legend).toContainText('первый синк, 12 мая');
  await expect(block.locator('li[title^="Неделя с 4 мая"]')).toHaveAttribute('title', 'Неделя с 4 мая: 2 ч (из них оценка 1 ч)');
  await expect(block.locator('li[title^="Неделя с 1 июн."] .ps-gd__mark svg')).toHaveCount(1);
  // нет горизонтального скролла
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('история без оценки: штриховки и пункта легенды нет', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL as string, (m) => {
    m.histories[1] = { ...history, hasEstimate: false, weeks: history.weeks.map((w) => ({ ...w, estimatedSeconds: 0 })) };
  });
  const block = page.getByRole('dialog', { name: 'Stray' }).getByTestId('game-history');
  await expect(block).toBeVisible();
  await expect(block.getByTestId('history-est')).toHaveCount(0);
  await expect(block.getByRole('list', { name: 'Обозначения графика' })).not.toContainText('оценка');
});

test('игра без снимков: только отметки трофеев и пояснение', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL as string, (m) => {
    m.histories[2] = { weeks: [week('2026-06-01', 0, 0, 3, false)], truncated: false, hasHours: false, hasEstimate: false, playedDays: null, firstSnapshotDate: null };
  }, 2);
  const block = page.getByRole('dialog', { name: 'Без снимков' }).getByTestId('game-history');
  await expect(block.getByTestId('history-line')).toHaveText('Последний раз 6 июн.');
  await expect(block).toContainText('Часы по неделям появятся после первого синка');
  await expect(block.locator('.ps-gd__stack')).toHaveCount(0);
  await expect(block.locator('.ps-gd__mark[data-mark="trophy"]')).toHaveCount(1);
});

test('старый ответ без history (null): блока нет, окно работает', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL as string, () => undefined, 3);
  await expect(page.getByRole('dialog', { name: 'Старый ответ' })).toBeVisible();
  await expect(page.getByTestId('game-history')).toHaveCount(0);
});

test('«Длительность прохождения» свёрнута до строки и раскрывается с клавиатуры', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL as string, (m) => { m.histories[1] = history; });
  const dlg = page.getByRole('dialog', { name: 'Stray' });
  const btn = dlg.getByRole('button', { name: /Длительность прохождения/ });
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(dlg.getByTestId('duration-summary')).toBeVisible();
  await expect(dlg.getByLabel('Своя оценка, часов')).toBeHidden();
  await btn.focus();
  await page.keyboard.press('Enter');
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(dlg.getByLabel('Своя оценка, часов')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(dlg.getByLabel('Своя оценка, часов')).toBeHidden();
});
