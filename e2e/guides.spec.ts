// F2-B (пакет 3): вкладка «Гайды» — точный гайд PowerPyx из индекса (с названием гайда), «Не тот гайд», своя ссылка;
// ссылки-поиск остаются всегда. API эмулируется (e2e/collection-mock.ts), БД не нужна.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed, type Mock } from './collection-mock';
import { signedSession } from './session';

const MATCH = { title: 'Resident Evil 8 Village', url: 'https://www.powerpyx.com/resident-evil-8-village-trophy-guide-roadmap/', wikiUrl: 'https://www.powerpyx.com/resident-evil-8-village-wiki-strategy-guide/' };

async function openGuides(page: Page, context: BrowserContext, baseURL: string, guide: Mock['guides'][number] | null): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const m = await mockApi(page, seed().map((g) => (g.id === 3 ? { ...g, title: 'Resident Evil Village' } : g)));
  if (guide) m.guides[3] = guide;
  await page.goto('/?game=3&tab=guides');
  const d = page.getByRole('dialog', { name: 'Resident Evil Village' });
  await d.getByRole('tab', { name: 'Гайды' }).click();
  await expect(d.getByRole('tab', { name: 'Гайды' })).toHaveAttribute('aria-selected', 'true');
  return m;
}
const guidePuts = (m: Mock) => m.mutations.filter((x) => x.url.endsWith('/guide')).map((x) => x.body);

test('найденный гайд: название из индекса, вики, поиск остаётся; «Не тот гайд» и «Вернуть»', async ({ page, context, baseURL }) => {
  const m = await openGuides(page, context, baseURL!, { match: MATCH, override: null, dismissed: false });
  const d = page.getByRole('dialog');
  const main = d.getByTestId('guide-match').getByRole('link', { name: /PowerPyx: Resident Evil 8 Village/ });
  await expect(main).toHaveAttribute('href', MATCH.url);
  await expect(main).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(d.getByRole('link', { name: /Wiki: Resident Evil 8 Village/ })).toHaveAttribute('href', MATCH.wikiUrl);
  await expect(d.getByRole('link', { name: /PowerPyx: найти гайд/ })).toBeVisible();
  await expect(d.getByRole('link', { name: /PSNProfiles: найти гайд/ })).toBeVisible();

  await d.getByTestId('guide-wrong').click();
  await expect(d.getByTestId('guide-match')).toHaveCount(0);
  await expect(d.getByRole('link', { name: /PowerPyx: найти гайд/ })).toBeVisible();
  expect(guidePuts(m)).toEqual([{ dismissed: true }]);
  await d.getByTestId('guide-restore').click();
  await expect(d.getByTestId('guide-match')).toBeVisible();
  expect(guidePuts(m).at(-1)).toEqual({ dismissed: false });
});

test('своя ссылка: добавить, ошибка сервера не теряет ввод, изменить, убрать', async ({ page, context, baseURL }) => {
  const m = await openGuides(page, context, baseURL!, { match: null, override: null, dismissed: false });
  const d = page.getByRole('dialog');
  await expect(d.getByTestId('guide-match')).toHaveCount(0);
  await d.getByTestId('guide-own-add').click();
  const input = d.getByLabel('Ссылка на гайд');
  await input.fill('https://psnprofiles.com/guide/123');
  m.failNextMutation = 400;
  await d.getByRole('button', { name: 'Сохранить' }).click();
  await expect(d.getByRole('alert')).toContainText('https://');
  await expect(input).toHaveValue('https://psnprofiles.com/guide/123');
  await d.getByRole('button', { name: 'Сохранить' }).click();
  const own = d.getByTestId('guide-own').getByRole('link', { name: /Мой гайд/ });
  await expect(own).toHaveAttribute('href', 'https://psnprofiles.com/guide/123');
  await expect(own).toContainText('psnprofiles.com');
  await d.getByRole('button', { name: 'Изменить ссылку' }).click();
  await d.getByLabel('Ссылка на гайд').fill('https://example.com/g');
  await d.getByLabel('Ссылка на гайд').press('Enter');
  await expect(d.getByTestId('guide-own').getByRole('link')).toHaveAttribute('href', 'https://example.com/g');
  await d.getByRole('button', { name: 'Убрать свою ссылку' }).click();
  await expect(d.getByTestId('guide-own')).toHaveCount(0);
  expect(guidePuts(m).at(-1)).toEqual({ override: null });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('старый сервер без поля guide: только ссылки-поиск, без кнопок', async ({ page, context, baseURL }) => {
  await openGuides(page, context, baseURL!, null);
  const d = page.getByRole('dialog');
  await expect(d.getByRole('link', { name: /PowerPyx: найти гайд/ })).toBeVisible();
  await expect(d.getByTestId('guide-own-add')).toHaveCount(0);
});
