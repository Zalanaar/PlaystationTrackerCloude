// Пакет 6, п. 11: «Прогноз бэклога» под «Прогрессом» на /roadmap — дата по темпу последних 90 дней (F4: от 30 дней истории) и по бюджету плана; без прогноза — понятная причина.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { baseState, mockRoadmap, type RmState } from './roadmap-mock';
import { signedSession } from './session';

const pace = (o: Record<string, unknown> = {}) => ({
  status: 'ok', from: '2026-10-02', to: '2026-10-29', days: 90, playedHours: 90, hoursPerWeek: 7, games: 4, unknownGames: 1, backlogHours: 92, weeks: 13.1, closeDate: '2027-01-28', ...o,
});

async function open(page: Page, context: BrowserContext, baseURL: string, s: RmState) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, []);
  await mockRoadmap(page, s);
  await page.goto('/roadmap');
  await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
}

test('дата по темпу, темп и остаток, игры без длительности; без горизонтальной прокрутки', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, baseState({ pace: pace() }));
  const box = page.getByTestId('rm-pace');
  await expect(box).toBeVisible();
  await expect(box.getByRole('heading', { name: 'Прогноз бэклога' })).toBeVisible();
  await expect(page.getByTestId('rm-pace-title')).toHaveText('Бэклог закончится ≈ в январе 2027');
  await expect(page.getByTestId('rm-pace-note')).toHaveText('В темпе последних 3 месяцев: 7 ч в неделю, в бэклоге 92 ч. У 1 игры нет длительности — она не учтена.');
  // блок внутри панели «Прогресс», после неё
  const prog = page.locator('[data-area="prog"]');
  await expect(prog.getByTestId('rm-pace')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('нет прогноза: не играл 3 месяца; мало истории; старый ответ без поля — блока нет', async ({ page, context, baseURL }) => {
  const s = baseState({ pace: pace({ status: 'no_pace', playedHours: 0, hoursPerWeek: 0, weeks: null, closeDate: null, unknownGames: 0 }) });
  await open(page, context, baseURL!, s);
  await expect(page.getByTestId('rm-pace-title')).toHaveText('За последние 3 месяца игр не было — темп не посчитать');
  await expect(page.getByTestId('rm-pace-note')).toHaveText('В бэклоге 92 ч.');
  await expect(page.getByTestId('rm-pace')).toHaveAttribute('data-kind', 'info');
  s.pace = pace({ status: 'no_data', days: 3, weeks: null, closeDate: null });
  await page.reload();
  await expect(page.getByTestId('rm-pace-title')).toHaveText('Прогноз появится через месяц истории часов');
  // F4: мало истории, но есть бюджет плана — показываем дату по бюджету
  s.pace = pace({ status: 'no_data', days: 23, weeks: null, closeDate: null, unknownGames: 0, budgetHoursPerWeek: 14, budgetWeeks: 6.6, budgetCloseDate: '2026-12-15' });
  await page.reload();
  await expect(page.getByTestId('rm-pace-title')).toHaveText('По бюджету плана бэклог закончится ≈ в декабре 2026');
  await expect(page.getByTestId('rm-pace-note')).toContainText('(сейчас 23 дня)');
  s.pace = undefined;
  await page.reload();
  await page.getByRole('heading', { name: 'Прогресс' }).waitFor();
  await expect(page.getByTestId('rm-pace')).toHaveCount(0);
});
