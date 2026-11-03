// QA хвостов 2026-10-31: R-1 (возврат фокуса на источник) в Бэклоге и «Подскажи», сценарий «список изменился после закрытия», R-2.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { signedSession } from './session';

const bl = (id: number, title: string, o: Partial<G> = {}): G => ({
  id, title, lastPlayedAt: null, status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null, genres: ['ACTION'], ...o,
});
const games = (): G[] => [bl(1, 'Альфа Экшен'), bl(2, 'Браво Хоррор'), bl(3, 'Чарли РПГ'), bl(4, 'Дельта Гонки')];

async function open(page: Page, context: BrowserContext, baseURL: string, url: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, games());
  await page.goto(url);
  return mock;
}
const gameDialog = (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('tab', { name: /Обзор/ }) });
const activeText = (page: Page) => page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return `${a?.tagName}|${(a?.getAttribute('aria-label') ?? a?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)}`; });

test.describe('R-1: Бэклог', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'desktop', 'клавиатурный сценарий'); });

  test('Enter на карточке, Esc: фокус возвращается на ту же карточку (не на первую)', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/backlog');
    await page.locator('.ps-card:not(.ps-card--sk)').first().waitFor();
    const card = page.locator('.ps-card', { hasText: 'Чарли РПГ' });
    const opener = card.locator('.ps-card__hit');
    await opener.focus();
    const before = await activeText(page);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/\?game=3/);
    await expect(gameDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/backlog/);
    await expect.poll(() => activeText(page), { timeout: 5000 }).toBe(before);
  });

  test('игра ушла из списка после закрытия (статус сменён в окне): фокус не прыгает на чужую карточку и не падает', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL!, '/backlog');
    await page.locator('.ps-card:not(.ps-card--sk)').first().waitFor();
    const card = page.locator('.ps-card', { hasText: 'Браво Хоррор' });
    const opener = card.locator('.ps-card__hit');
    await opener.focus();
    await page.keyboard.press('Enter');
    const dlg = gameDialog(page);
    await expect(dlg).toBeVisible();
    // статус меняем в самом окне, как пользователь: запись через общий HTTP-слой сбрасывает кэш GET (Фаза 47).
    // Правка мока в обход приложения кэш не сбрасывала, и Бэклог законно показывал прежний список 30 с.
    await dlg.getByRole('button', { name: 'Изменить статус' }).click();
    await page.getByRole('menuitemradio', { name: 'Играю' }).click();
    await expect.poll(() => mock.mutations.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'playing' } });
    await expect(dlg.locator('.ps-chip')).toContainText('Играю');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/backlog/);
    await expect(page.locator('.ps-card', { hasText: 'Браво' })).toHaveCount(0);
    await expect(page.locator('.ps-card', { hasText: 'Чарли' })).toBeVisible();
    await page.waitForTimeout(800); // возврат фокуса отрабатывает после перерисовки списка
    const act = await activeText(page);
    console.log('после закрытия, список изменён: активный элемент =', act);
    expect(act).not.toContain('Чарли');
    expect(act).not.toContain('Дельта');
  });

  test('Esc вернул фокус; последующая клавиша Tab идёт от источника, а не с начала страницы', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/backlog');
    await page.locator('.ps-card:not(.ps-card--sk)').first().waitFor();
    const opener = page.locator('.ps-card', { hasText: 'Дельта Гонки' }).locator('.ps-card__hit');
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(gameDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/backlog/);
    await page.waitForTimeout(800);
    const a = await activeText(page);
    expect(a).not.toMatch(/^BODY/);
    console.log('Бэклог, Дельта: фокус после Esc =', a);
  });
});

test.describe('R-2: игра не найдена', () => {
  test('/?game=999999 по прямой ссылке: тост, адрес очищен, остаёмся на «/», окна нет', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/?game=999999');
    await expect(page.getByText('Игра не найдена. Возможно, ссылка устарела.')).toBeVisible();
    await expect(page).not.toHaveURL(/game=/);
    await expect(page).toHaveURL(/\/$/);
    await expect(gameDialog(page)).toHaveCount(0);
  });

  test('/?game=abc: тост один раз, адрес очищен', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/?game=abc');
    await expect(page.getByText('Игра не найдена. Возможно, ссылка устарела.')).toHaveCount(1);
    await expect(page).not.toHaveURL(/game=/);
  });
});
