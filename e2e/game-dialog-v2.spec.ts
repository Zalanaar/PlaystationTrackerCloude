// Batch 1: окно игры v2 — D-P4 (чипы, 3 метрики), F1 «Моя оценка» (0–10 + заметка, ★ на карточке, сортировка), F2-A «Гайды».
// API эмулируется по контракту (e2e/collection-mock.ts, F1.1), БД не нужна.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed, serviceGames, type G, type Mock } from './collection-mock';
import { signedSession } from './session';

async function open(page: Page, context: BrowserContext, baseURL: string, url: string, games: G[] = seed()): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, games);
  await page.goto(url);
  return mock;
}
const dlg = (page: Page, name: string) => page.getByRole('dialog', { name });
const reviewPuts = (m: Mock) => m.mutations.filter((x) => x.url.endsWith('/review'));
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('Batch 1: окно игры v2', () => {
  test('D-P4: чип статуса с датой и ✎, три метрики одной строкой, платина в ячейке трофеев, блока «Статус и даты» нет', async ({ page, context, baseURL }, info) => {
    await open(page, context, baseURL!, '/?game=1');
    const d = dlg(page, 'The Witcher 3: Wild Hunt');
    await expect(d).toBeVisible();
    await expect(d.getByRole('button', { name: 'Пройдено, изменить статус' })).toBeVisible();
    await expect(d.getByTestId('done-date')).toContainText('10.03.2025');
    const edit = d.getByRole('button', { name: /изменить дату$/ });
    const eb = await edit.boundingBox();
    if (info.project.name === 'mobile') expect(Math.round(eb!.width)).toBeGreaterThanOrEqual(44);
    const tiles = d.locator('.ps-gd__tiles > li');
    await expect(tiles).toHaveCount(3);
    const ys = await tiles.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(ys).size).toBe(1);
    await expect(d.getByRole('listitem', { name: /^Трофеи: 78\/78, 100%, платина \d/ })).toBeVisible();
    await expect(d.getByTestId('platinum-line')).toContainText(/^платина \d/);
    await expect(d.getByRole('heading', { name: 'Статус и даты' })).toHaveCount(0);
    await expect(d.getByRole('heading', { name: 'Даты' })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // ✎ раскрывает форму даты
    await edit.click();
    await expect(d.getByLabel('Дата завершения')).toHaveValue('2025-03-10');
    await d.getByRole('button', { name: 'Отмена' }).click();
    await expect(d.getByLabel('Дата завершения')).toHaveCount(0);
  });

  test('F1: оценка сохраняется сразу, 0 — настоящая оценка, «Сбросить» = без оценки; ★ на карточке после закрытия', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, '/?game=4');
    const d = dlg(page, 'God of War');
    const rv = d.getByTestId('game-review');
    await expect(rv).toBeVisible();
    await expect(d.getByTestId('review-value')).toHaveText('без оценки');
    await rv.getByRole('radio', { name: '8', exact: true }).check();
    await expect(d.getByTestId('review-value')).toHaveText('8/10');
    await expect(rv.getByRole('status')).toHaveText('Сохранено');
    expect(reviewPuts(m).at(-1)!.body).toEqual({ rating: 8, note: null });
    await rv.getByRole('radio', { name: '0', exact: true }).check();
    await expect(d.getByTestId('review-value')).toHaveText('0/10');
    await expect.poll(() => (reviewPuts(m).at(-1)!.body as { rating: number }).rating).toBe(0);
    await rv.getByRole('radio', { name: '9', exact: true }).check();
    await expect.poll(() => (reviewPuts(m).at(-1)!.body as { rating: number }).rating).toBe(9);
    await d.getByRole('button', { name: 'Закрыть' }).click();
    await expect(d).toHaveCount(0);
    const card = page.locator('article.ps-card[data-game="4"]').first();
    await expect(card.getByTestId('card-rating')).toHaveText('★ 9');
    await expect(card.getByRole('button', { name: /^Открыть: God of War, оценка 9 из 10$/ })).toBeAttached();
    // сброс
    await card.getByRole('button', { name: /^Открыть: God of War/ }).click();
    await d.getByRole('button', { name: 'Сбросить оценку' }).click();
    await expect(d.getByTestId('review-value')).toHaveText('без оценки');
    await expect.poll(() => reviewPuts(m).at(-1)!.body).toEqual({ rating: null, note: null });
  });

  test('F1: заметка — пауза ввода, счётчик 500, длиннее не уходит; закрытие окна досылает несохранённое', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, '/?game=6');
    const d = dlg(page, 'Stray');
    const note = d.getByLabel('Заметка');
    await note.fill('Кот и неон');
    await expect(d.getByText('10/500')).toBeVisible();
    await expect.poll(() => reviewPuts(m).at(-1)?.body).toEqual({ rating: null, note: 'Кот и неон' });
    await note.fill('x'.repeat(501));
    await expect(note).toHaveAttribute('aria-invalid', 'true');
    await expect(d.getByRole('status').filter({ hasText: 'длиннее 500' })).toBeVisible();
    await page.waitForTimeout(1000);
    expect(reviewPuts(m)).toHaveLength(1);
    await note.fill('Финал');
    await d.getByRole('button', { name: 'Закрыть' }).click();
    await expect.poll(() => reviewPuts(m).at(-1)?.body).toEqual({ rating: null, note: 'Финал' });
  });

  test('F1: оценка и заметка из деталей, ★ в строке списка и сортировка «По оценке»', async ({ page, context, baseURL }, info) => {
    const games = seed().map((g) => (g.id === 3 ? { ...g, rating: 7, note: 'Красиво' } : g.id === 6 ? { ...g, rating: 0 } : g.id === 4 ? { ...g, rating: 10 } : g));
    const m = await open(page, context, baseURL!, '/?game=3', games);
    const d = dlg(page, 'Horizon Forbidden West');
    await expect(d.getByTestId('review-value')).toHaveText('7/10');
    await expect(d.getByLabel('Заметка')).toHaveValue('Красиво');
    await d.getByRole('button', { name: 'Закрыть' }).click();
    await expect(page).not.toHaveURL(/game=/); // закрытие меняет адрес; иначе goto ниже перебивается этим переходом (WebKit)
    if (info.project.name !== 'mobile') {
      await page.goto('/?view=list&sort=rating');
      await expect(page.getByTestId('row-rating')).toHaveText(['★ 10', '★ 7', '★ 0']);
      await expect(page.locator('.ps-row[data-status]').first().getByRole('button', { name: 'Открыть: God of War, оценка 10 из 10' })).toBeAttached();
      expect(m.listCalls.some((u) => u.searchParams.get('sort') === 'rating')).toBe(true);
    }
  });

  test('F2-A: «Гайды» — ссылки PowerPyx и PSNProfiles по очищенному названию; у сервиса вкладки нет', async ({ page, context, baseURL }) => {
    const games = [...seed().map((g) => (g.id === 3 ? { ...g, title: 'Horizon Forbidden West™ (PS4 & PS5)' } : g)), ...serviceGames(1)];
    await open(page, context, baseURL!, '/?game=3', games);
    const d = dlg(page, 'Horizon Forbidden West™ (PS4 & PS5)');
    await d.getByRole('tab', { name: 'Гайды' }).click();
    const pp = d.getByRole('link', { name: /PowerPyx/ });
    await expect(pp).toHaveAttribute('href', 'https://www.powerpyx.com/?s=Horizon+Forbidden+West+trophy+guide');
    await expect(pp).toHaveAttribute('target', '_blank');
    await expect(pp).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(d.getByRole('link', { name: /PSNProfiles/ })).toHaveAttribute('href', 'https://psnprofiles.com/search/guides?q=Horizon+Forbidden+West');
    await page.goto('/?game=100');
    const s = dlg(page, 'Сервис 1');
    await expect(s.getByRole('tab', { name: 'Обзор' })).toBeVisible();
    await expect(s.getByRole('tab')).toHaveCount(2);
  });
});
