// t189u: релиз («Хочу пройти на релизе», Until Dawn 2 — 28 янв.) стоит на таймлайне по своей дате, а не первым в месяце.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { baseState, mockRoadmap } from './roadmap-mock';
import { signedSession } from './session';

const state = () => baseState({
  year: 2026, today: '2026-01-01', hoursPerWeek: 10,
  games: [{ id: 1, title: 'SILENT HILL f', hours: 10, source: 'manual' }, { id: 2, title: 'Элден Ринг', hours: 30, source: 'hltb' }],
  order: [1, 2],
  planned: [{ id: 7, title: 'Until Dawn 2', releaseDate: '2026-01-28', coverUrl: null, wantAtRelease: true, hoursManual: 10, externalSource: 'rawg', externalId: '7', status: 'planned' }],
});

async function open(page: Page, context: BrowserContext, baseURL: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, []);
  // мок раскладывает релизы первыми (как сервер до исправления): порядок в месяце должен навести экран
  await mockRoadmap(page, state());
  await page.goto('/roadmap');
  await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
}

test('«По месяцам»: в январе игры по дате начала — релиз «с 28 янв.» после SILENT HILL 1–7 янв.', async ({ page, context, baseURL, isMobile }) => {
  await open(page, context, baseURL!);
  if (!isMobile) await page.getByRole('group', { name: 'Вид таймлайна' }).getByRole('button', { name: 'По месяцам' }).click();
  const jan = page.getByTestId('rm-month').filter({ has: page.getByRole('heading', { name: 'Январь' }) });
  const rows = jan.locator('.ps-rm-mo__g');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('SILENT HILL f');
  await expect(rows.nth(1)).toContainText('Элден Ринг');
  await expect(rows.nth(2)).toContainText('Until Dawn 2');
  await expect(rows.nth(2)).toContainText('с 28 янв.');
  // февраль: окно релиза (до 3 фев.) раньше продолжения очереди
  const feb = page.getByTestId('rm-month').filter({ has: page.getByRole('heading', { name: 'Февраль' }) });
  await expect(feb.locator('.ps-rm-mo__g').first()).toContainText(/Until Dawn 2|Элден Ринг/);
});

test('«Полосы»: полоса релиза по дате — правее полосы SILENT HILL', async ({ page, context, baseURL, isMobile }) => {
  test.skip(isMobile, '«Полосы» только на десктопе');
  await open(page, context, baseURL!);
  const sh = page.locator('[data-testid="rm-bar"][data-key="g:1"]');
  const ud = page.locator('[data-testid="rm-bar"][data-key="p:7"]');
  await expect(ud).toBeVisible();
  const a = (await sh.boundingBox())!;
  const b = (await ud.boundingBox())!;
  expect(b.x).toBeGreaterThan(a.x + a.width);
});
