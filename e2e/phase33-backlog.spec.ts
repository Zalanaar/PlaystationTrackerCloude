// Фаза 33: компактный Бэклог. Вид «Список», sheet фильтров, меню страницы, первый экран 360 px, шаг тура. API эмулируется.
import { test, expect, type Page } from '@playwright/test';
import { mockApi, type G, type Mock } from './collection-mock';
import { isMobile, openFilters } from './backlog-ui';
import { signedSession } from './session';

// вид по умолчанию проверяем без предустановленного ps-bl-view
test.use({ storageState: { cookies: [], origins: [] } });

const bl = (id: number, title: string, o: Partial<G> = {}): G => ({
  id, title, lastPlayedAt: '2026-09-01T10:00:00.000Z', status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null, ...o,
});
const games = (): G[] => [
  bl(1, 'Альфа Экшен', { genres: ['ACTION'], hltbHours: 8, hltbName: 'Alpha', hltbChecked: true }),
  bl(2, 'Браво Хоррор с очень длинным названием для проверки обрезки строки', { genres: ['HORROR'], hltbHours: 12.4, hltbName: 'Bravo', hltbChecked: true }),
  bl(3, 'Чарли Нет на HLTB', { genres: ['RACING'], hltbChecked: true }),
  bl(4, 'Дельта Не проверена', { genres: ['ACTION'] }),
  bl(5, 'Эхо Ручная', { genres: ['ACTION'], override: 25, hltbChecked: true }),
  bl(6, 'Сервис Игра', { status: 'service' }),
];
const tourStub = JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } });

async function open(page: Page, baseURL: string, context: import('@playwright/test').BrowserContext, url = '/backlog'): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: tourStub }));
  const mock = await mockApi(page, games());
  await page.goto(url);
  if (url !== '/backlog') { await page.locator('.ps-card').first().waitFor(); return mock; }
  await page.getByRole('heading', { name: 'Бэклог', level: 1 }).waitFor();
  await page.locator('.ps-card:not(.ps-card--sk), .ps-blrow, .ps-empty').first().waitFor();
  return mock;
}
const rows = (page: Page) => page.locator('.ps-bl-list .ps-blrow');

test.describe('Бэклог: вид по умолчанию и переключатель', () => {
  test('мобильный: список, десктоп: карточки; выбор переживает перезагрузку', async ({ page, context, baseURL }) => {
    await open(page, baseURL!, context);
    if (isMobile(page)) {
      await expect(rows(page)).toHaveCount(5);
      await page.getByRole('button', { name: 'Карточки' }).click();
      await expect(page.locator('.ps-bl-list .ps-card:not(.ps-card--sk)')).toHaveCount(5);
      await page.reload();
      await expect(page.locator('.ps-bl-list .ps-card:not(.ps-card--sk)')).toHaveCount(5);
      await page.getByRole('button', { name: 'Список' }).click();
      await expect(rows(page)).toHaveCount(5);
    } else {
      await expect(page.locator('.ps-bl-list .ps-card:not(.ps-card--sk)')).toHaveCount(5);
      await expect(rows(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'Список' }).click();
      await expect(rows(page)).toHaveCount(5);
      await page.reload();
      await expect(rows(page)).toHaveCount(5);
    }
    await expect(page.locator('[data-tour="backlog-list"]')).toHaveCount(1);
  });
});

test.describe('Бэклог: строка списка', () => {
  test.beforeEach(async ({ page, context, baseURL }) => {
    await open(page, baseURL!, context);
    if (!isMobile(page)) await page.getByRole('button', { name: 'Список' }).click();
    await expect(rows(page)).toHaveCount(5);
  });

  test('длительность: часы и источник, только «нет на HLTB», ничего без данных', async ({ page }) => {
    const dur = (t: string) => rows(page).filter({ hasText: t }).getByTestId('bl-duration');
    await expect(dur('Альфа')).toContainText('≈ 8 ч');
    await expect(dur('Альфа')).toContainText('HLTB');
    await expect(dur('Эхо')).toContainText('≈ 25 ч');
    await expect(dur('Эхо')).toContainText('вручную');
    await expect(dur('Чарли')).toHaveText('нет на HLTB');
    await expect(dur('Дельта')).toHaveCount(0);
    // остаток часов не выдумываем
    await expect(page.locator('.ps-bl-list .ps-bl-rows')).not.toContainText('осталось');
  });

  test('«Играть» ставит playing, строка уходит из бэклога', async ({ page }) => {
    await page.getByRole('button', { name: 'Начать играть: Альфа Экшен' }).click();
    await expect(rows(page).filter({ hasText: 'Альфа' })).toHaveCount(0);
    await expect(rows(page)).toHaveCount(4);
  });

  test('меню «…»: в сервис; нажатие по строке открывает окно игры', async ({ page }) => {
    await page.getByRole('button', { name: 'Действия: Дельта Не проверена' }).click();
    await page.getByRole('menuitem', { name: 'В сервис' }).click();
    await expect(rows(page).filter({ hasText: 'Дельта' })).toHaveCount(0);
    await expect(page.getByTestId('bl-service')).toContainText('Дельта');
    await page.getByRole('button', { name: 'Открыть: Альфа Экшен' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});

test.describe('Бэклог: мобильная панель', () => {
  test.beforeEach(({ page }) => { test.skip(!isMobile(page), 'мобильная панель'); });

  test('360x640: первая строка целиком выше нижней навигации, нет горизонтального скролла (360 и 320)', async ({ page, context, baseURL }) => {
    for (const [w, h] of [[360, 640], [320, 568]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await open(page, baseURL!, context);
      const box = await rows(page).first().boundingBox();
      const tab = await page.locator('.ps-tabbar').boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(tab!.y + 0.5);
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(ov).toBeLessThanOrEqual(0);
    }
  });

  test('sheet: сортировка, фильтры, бейдж, «Показать N», Esc возвращает фокус', async ({ page, context, baseURL }) => {
    await open(page, baseURL!, context);
    const btn = page.getByRole('button', { name: /^Фильтры и сортировка/ });
    await openFilters(page);
    await page.getByRole('button', { name: 'Экшен: 3', exact: true }).click();
    await expect(page).toHaveURL(/genres=ACTION/);
    await expect(rows(page)).toHaveCount(3);
    await page.getByRole('radio', { name: 'По названию' }).click();
    await expect(page).toHaveURL(/sort=title/);
    await expect(page.getByRole('radio', { name: 'По названию' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: 'Показать 3' })).toBeVisible();
    await page.getByRole('button', { name: 'Показать 3' }).click();
    await expect(page.getByRole('dialog', { name: 'Фильтры и сортировка' })).toHaveCount(0);
    await expect(btn).toHaveAttribute('aria-label', 'Фильтры и сортировка, активно: 2');
    await btn.click();
    // dispatchEvent: dev-оверлей Next в левом нижнем углу перехватывает указатель (в проде его нет)
    await page.getByRole('button', { name: 'Сбросить', exact: true }).dispatchEvent('click');
    await expect(rows(page)).toHaveCount(5);
    await page.keyboard.press('Escape');
    await expect(btn).toBeFocused();
  });

  test('меню страницы запускает HLTB', async ({ page, context, baseURL }) => {
    const mock = await open(page, baseURL!, context);
    mock.hltbRuns.push({ data: { processed: 1, found: 1, notFound: 0, failed: 0, remaining: 0, done: true, stopReason: 'complete', warnings: [] } });
    await page.getByRole('button', { name: 'Ещё: действия со страницей' }).click();
    await page.getByRole('menuitem', { name: /^Подтянуть длительность с HLTB/ }).click();
    await expect(page.getByTestId('hltb-result')).toContainText('Готово.');
    await expect(page.getByRole('button', { name: 'Ещё: действия со страницей' })).toBeVisible();
  });
});

test.describe('Тур: шаг «Бэклог»', () => {
  test('подсвечивает список в любом виде, тур не ломается', async ({ page, context, baseURL }) => {
    await open(page, baseURL!, context, '/');
    if (isMobile(page)) { await page.getByRole('button', { name: 'Меню', exact: true }).click(); await page.getByRole('button', { name: 'Как пользоваться' }).click(); }
    else { await page.locator('.ps-avatar').click(); await page.getByRole('menuitem', { name: 'Как пользоваться' }).click(); }
    const dlg = page.getByRole('dialog').filter({ has: page.getByTestId('tour-count') });
    for (let i = 1; i < 8; i++) await dlg.getByRole('button', { name: 'Далее' }).click();
    await expect(page.getByTestId('tour-count')).toHaveText('8 из 14');
    await expect(dlg).toContainText('Бэклог');
    await expect(page.locator('[data-tour="backlog-list"]')).toHaveCount(1);
    await expect(page.locator('.ps-tour__spot')).toBeVisible();
    await dlg.getByRole('button', { name: 'Далее' }).click();
    await expect(page.getByTestId('tour-count')).toHaveText('9 из 14');
  });
});
