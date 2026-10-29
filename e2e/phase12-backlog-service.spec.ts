// Страница «Бэклог»: два блока (бэклог и сервис), переезд игры без перезагрузки страницы. API эмулируется (e2e/collection-mock.ts).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G, type Mock, type Status } from './collection-mock';
import { signedSession } from './session';

const g = (id: number, title: string, status: Status | null, o: Partial<G> = {}): G => ({
  id, title, lastPlayedAt: `2026-0${id}-01T10:00:00.000Z`, status, completedAt: null, droppedAt: null, playSeconds: 3600, playCount: 1, trophies: null, ...o,
});
const base = (): G[] => [g(1, 'Альфа Экшен', 'backlog'), g(2, 'Браво Хоррор', 'backlog'), g(3, 'Фортнайт Сервис', 'service'), g(4, 'Дестини Сервис', 'service')];

async function open(page: Page, context: BrowserContext, baseURL: string, games: G[] = base()): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, games);
  await page.goto('/backlog');
  await page.getByRole('heading', { name: 'Бэклог', level: 1 }).waitFor();
  await page.locator('.ps-bl-list .ps-card:not(.ps-card--sk), .ps-empty').first().waitFor();
  return mock;
}
const blTitles = (page: Page) => page.locator('.ps-bl-list .ps-card__title').allTextContents();
const svTitles = (page: Page) => page.getByTestId('bl-service').locator('.ps-card__title').allTextContents();

test.describe('Бэклог: блок «Сервис»', () => {
  test('два блока: бэклог и сервис с количеством, фильтры бэклога сервис не затрагивают', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string);
    expect(await blTitles(page)).toHaveLength(2);
    await expect(page.getByTestId('bl-service-count')).toHaveText('2');
    expect((await svTitles(page)).sort()).toEqual(['Дестини Сервис', 'Фортнайт Сервис']);
    // запрос сервиса не несёт фильтров бэклога
    const svCall = mock.listCalls.find((u) => u.searchParams.get('status') === 'service') as URL;
    expect(svCall.searchParams.get('genres')).toBeNull();
    // у карточки сервиса нет «Начать играть»
    await expect(page.getByTestId('bl-service').getByRole('button', { name: 'Начать играть' })).toHaveCount(0);
    await expect(page.getByTestId('bl-service').getByRole('button', { name: 'Вернуть в бэклог' })).toHaveCount(2);
  });

  test('пустой блок «Сервис» скрыт', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, [g(1, 'Альфа Экшен', 'backlog')]);
    await expect(page.getByTestId('bl-service')).toHaveCount(0);
  });

  test('из бэклога в сервис без перезагрузки, «Отменить» возвращает', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string, [g(1, 'Альфа Экшен', 'backlog'), g(2, 'Браво Хоррор', 'backlog')]);
    await expect(page.getByTestId('bl-service')).toHaveCount(0);
    const card = page.locator('.ps-bl-list .ps-card', { hasText: 'Альфа Экшен' });
    await card.getByRole('button', { name: 'В сервис' }).click();
    await expect(page.getByText('Статус изменён: Сервис')).toBeVisible();
    expect(await blTitles(page)).toEqual(['Браво Хоррор']);
    expect(await svTitles(page)).toEqual(['Альфа Экшен']);
    await expect(page.getByTestId('bl-service-count')).toHaveText('1');
    await expect(page.locator('.ps-statline')).toContainText('1');
    expect(mock.games.find((x) => x.id === 1)?.status).toBe('service');
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByTestId('bl-service')).toHaveCount(0);
    await expect.poll(() => blTitles(page).then((l) => l.sort())).toEqual(['Альфа Экшен', 'Браво Хоррор']);
    expect(mock.games.find((x) => x.id === 1)?.status).toBe('backlog');
  });

  test('из сервиса в бэклог и «Убрать из сервиса»', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string);
    await page.getByTestId('bl-service').locator('.ps-card', { hasText: 'Фортнайт Сервис' }).getByRole('button', { name: 'Вернуть в бэклог' }).click();
    await expect.poll(() => blTitles(page).then((l) => l.length)).toBe(3);
    expect(await svTitles(page)).toEqual(['Дестини Сервис']);
    await expect(page.getByTestId('bl-service-count')).toHaveText('1');
    expect(mock.games.find((x) => x.id === 3)?.status).toBe('backlog');
    await page.getByTestId('bl-service').getByRole('button', { name: 'Убрать из сервиса' }).click();
    await expect(page.getByTestId('bl-service')).toHaveCount(0);
    expect(mock.games.find((x) => x.id === 4)?.status).toBeNull();
    expect(await blTitles(page)).toHaveLength(3);
  });

  test('блок «Сервис» сворачивается', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    const btn = page.getByTestId('bl-service').getByRole('button', { name: 'Свернуть' });
    await btn.click();
    await expect(page.getByTestId('bl-service').locator('.ps-card')).toHaveCount(0);
    await expect(page.getByTestId('bl-service').getByRole('button', { name: 'Развернуть' })).toHaveAttribute('aria-expanded', 'false');
  });
});
