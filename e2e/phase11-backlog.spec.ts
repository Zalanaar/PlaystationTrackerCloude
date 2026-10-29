// Фаза 11: бэклог с фильтрами жанр/длительность, сортировка по длительности, ручной ввод. API эмулируется (e2e/collection-mock.ts).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G, type Mock } from './collection-mock';
import { signedSession } from './session';

const bl = (id: number, title: string, o: Partial<G> = {}): G => ({
  id, title, lastPlayedAt: null, status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null, ...o,
});
const games = (): G[] => [
  bl(1, 'Альфа Экшен', { genres: ['ACTION'], hltbHours: 8, hltbName: 'Alpha Action', lastPlayedAt: '2026-09-01T10:00:00.000Z' }),
  bl(2, 'Браво Хоррор', { genres: ['HORROR'], hltbHours: 12.4, hltbName: 'Bravo Horror', lastPlayedAt: '2026-08-01T10:00:00.000Z' }),
  bl(3, 'Чарли РПГ', { genres: ['ROLE_PLAYING_GAMES', 'ACTION'], hltbHours: 75, hltbName: 'Charlie RPG', lastPlayedAt: '2026-07-01T10:00:00.000Z' }),
  bl(4, 'Дельта Гонки', { genres: ['RACING'], hltbChecked: true, lastPlayedAt: '2026-06-01T10:00:00.000Z' }),
  bl(5, 'Эхо Ручная', { genres: ['ACTION'], override: 25, hltbHours: 9, hltbName: 'Echo', lastPlayedAt: '2026-05-01T10:00:00.000Z' }),
  { id: 6, title: 'Не в бэклоге', lastPlayedAt: null, status: 'playing', completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null, genres: ['HORROR'] },
];

async function open(page: Page, context: BrowserContext, baseURL: string, url = '/backlog'): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, games());
  await page.goto(url);
  await page.getByRole('heading', { name: 'Бэклог', level: 1 }).waitFor();
  await page.locator('.ps-card:not(.ps-card--sk), .ps-empty').first().waitFor();
  return mock;
}
const titles = (page: Page) => page.locator('.ps-card__title').allTextContents();

test.describe('Бэклог: длительность и фильтры', () => {
  test('карточки показывают длительность, источник и прочерк', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await expect(page.locator('.ps-card:not(.ps-card--sk)')).toHaveCount(5);
    const dur = page.getByTestId('bl-duration');
    await expect(dur.nth(0)).toContainText('≈ 8 ч');
    await expect(dur.nth(0)).toContainText('HLTB');
    await expect(page.locator('.ps-card', { hasText: 'Дельта' }).getByTestId('bl-duration')).toContainText('—');
    await expect(page.locator('.ps-card', { hasText: 'Эхо' }).getByTestId('bl-duration')).toContainText('≈ 25 ч');
    await expect(page.locator('.ps-card', { hasText: 'Эхо' }).getByTestId('bl-duration')).toContainText('вручную');
  });

  test('чипы длительности: счётчики, ИЛИ внутри, URL', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string);
    await expect(page.getByRole('button', { name: 'До 10 ч: 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: '10–30 ч: 2' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Неизвестно: 1' })).toBeVisible();
    await page.getByRole('button', { name: '10–30 ч: 2' }).click();
    await expect(page).toHaveURL(/duration=10_30/);
    expect(await titles(page)).toEqual(['Браво Хоррор', 'Эхо Ручная']);
    await page.getByRole('button', { name: 'Неизвестно: 1' }).click();
    await expect(page).toHaveURL(/duration=10_30%2Cunknown/);
    await expect(page.locator('.ps-card:not(.ps-card--sk)')).toHaveCount(3);
    // счётчики не зависят от выбранной длительности
    await expect(page.getByRole('button', { name: 'До 10 ч: 1' })).toBeVisible();
    const last = mock.listCalls.at(-1) as URL;
    expect(last.searchParams.get('status')).toBe('backlog');
    expect(last.searchParams.get('duration')).toBe('10_30,unknown');
  });

  test('жанры: мульти ИЛИ, состояние в URL переживает перезагрузку', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await page.getByRole('button', { name: /^Жанр/ }).click();
    await page.getByRole('button', { name: 'Хоррор: 1', exact: true }).click();
    await page.getByRole('button', { name: 'Гонки: 1', exact: true }).click();
    await expect(page).toHaveURL(/genres=HORROR%2CRACING/);
    await expect(page.locator('.ps-card:not(.ps-card--sk)')).toHaveCount(2);
    await page.reload();
    await expect(page.locator('.ps-card:not(.ps-card--sk)')).toHaveCount(2);
    await expect(page.getByRole('button', { name: /^Жанр/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: 'Хоррор: 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('жанры: счётчики на чипах не зависят от выбранных жанров', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await page.getByRole('button', { name: /^Жанр/ }).click();
    await expect(page.getByRole('button', { name: 'Экшен: 3', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ролевые: 1', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Приключения: 0', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Без жанра/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Экшен: 3', exact: true }).click();
    await expect(page.locator('.ps-card:not(.ps-card--sk)')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Гонки: 1', exact: true })).toBeVisible();
    // фильтр длительности сужает счётчики жанров
    await page.getByRole('button', { name: '10–30 ч: 1' }).click();
    await expect(page.getByRole('button', { name: 'Экшен: 1', exact: true })).toBeVisible();
  });

  test('чип «Без жанра»: счётчик, ИЛИ с обычным жанром, URL, перезагрузка', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL as string }]);
    const mock = await mockApi(page, [...games(), bl(7, 'Зулу Безымянная', { genres: [], hltbHours: 5, hltbName: 'Zulu' })]);
    await page.goto('/backlog');
    await page.locator('.ps-card:not(.ps-card--sk)').first().waitFor();
    await page.getByRole('button', { name: /^Жанр/ }).click();
    const none = page.getByRole('button', { name: 'Без жанра: 1', exact: true });
    await expect(none).toBeVisible();
    // игра без жанров считается и в «Другое»
    await expect(page.getByRole('button', { name: 'Другое: 1', exact: true })).toBeVisible();
    await none.click();
    await expect(page).toHaveURL(/genres=none$/);
    expect(await titles(page)).toEqual(['Зулу Безымянная']);
    expect((mock.listCalls.at(-1) as URL).searchParams.get('genres')).toBe('none');
    await page.getByRole('button', { name: 'Хоррор: 1', exact: true }).click();
    await expect(page).toHaveURL(/genres=none%2CHORROR/);
    await expect(page.locator('.ps-card:not(.ps-card--sk)')).toHaveCount(2);
    await page.reload();
    await expect(page.locator('.ps-card:not(.ps-card--sk)')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Без жанра: 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('сортировка по длительности: короткие, длинные, без длительности в конце', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await page.getByLabel('Сортировка').selectOption('duration');
    await expect(page).toHaveURL(/sort=duration/);
    await expect.poll(() => titles(page)).toEqual(['Альфа Экшен', 'Браво Хоррор', 'Эхо Ручная', 'Чарли РПГ', 'Дельта Гонки']);
    await page.getByLabel('Сортировка').selectOption('duration_desc');
    await expect(page).toHaveURL(/order=desc/);
    await expect.poll(() => titles(page)).toEqual(['Чарли РПГ', 'Эхо Ручная', 'Браво Хоррор', 'Альфа Экшен', 'Дельта Гонки']);
  });

  test('пустой результат фильтров и сброс', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, '/backlog?duration=60plus&genres=RACING');
    await expect(page.getByText('Ничего не найдено')).toBeVisible();
    await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
    await expect(page.locator('.ps-card:not(.ps-card--sk)')).toHaveCount(5);
    await expect(page).toHaveURL(/\/backlog$/);
  });

  test('ошибка обновления не стирает список', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string);
    mock.listFails = true;
    await page.getByRole('button', { name: '10–30 ч: 2' }).click();
    // список остаётся на экране, ошибка показывается тостом
    await expect(page.getByText('Не удалось обновить список. База данных недоступна.')).toBeVisible();
    await expect(page.locator('.ps-card:not(.ps-card--sk)')).toHaveCount(5);
    mock.listFails = false;
    await page.getByRole('button', { name: '10–30 ч: 2' }).click();
    await page.getByRole('button', { name: '10–30 ч: 2' }).click();
    await expect(page.locator('.ps-card:not(.ps-card--sk)')).toHaveCount(2);
  });

  test('без горизонтального скролла', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await page.getByRole('button', { name: /^Жанр/ }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('Ручной ввод длительности', () => {
  test('окно игры: HLTB, ввод, сохранение, сброс', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string);
    await page.getByRole('button', { name: 'Открыть: Браво Хоррор' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByTestId('duration-hltb')).toContainText('Найдено: Bravo Horror');
    await expect(dlg.getByTestId('duration-now')).toContainText('≈ 12 ч');
    await expect(dlg.getByRole('button', { name: 'Сбросить ручное значение' })).toHaveCount(0);

    // неверный ввод не уходит на сервер
    const field = dlg.getByLabel('Своя оценка, часов');
    await field.fill('abc');
    await dlg.getByRole('button', { name: 'Сохранить длительность' }).click();
    await expect(dlg.getByRole('alert')).toContainText('Введи число часов');
    expect(mock.mutations.filter((x) => x.url.includes('/duration'))).toHaveLength(0);

    await field.fill('40,5');
    await dlg.getByRole('button', { name: 'Сохранить длительность' }).click();
    await expect(dlg.getByTestId('duration-now')).toContainText('≈ 41 ч');
    await expect(dlg.getByTestId('duration-now')).toContainText('вручную');
    await expect(dlg.getByRole('status')).toHaveText('Сохранено');
    const call = mock.mutations.find((x) => x.url.includes('/duration'));
    expect(call?.method).toBe('PATCH');
    expect(call?.body).toEqual({ hours: 40.5 });

    await dlg.getByRole('button', { name: 'Сбросить ручное значение' }).click();
    await expect(dlg.getByTestId('duration-now')).toContainText('≈ 12 ч');
    await expect(dlg.getByTestId('duration-now')).toContainText('HLTB');
    expect(mock.mutations.at(-1)?.body).toEqual({ hours: null });
    await expect(dlg.getByLabel('Своя оценка, часов')).toHaveValue('');
  });

  test('игра без HLTB: статус «не найдено», ввод включает фильтр и карточку', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, '/backlog?duration=unknown');
    await expect(page.locator('.ps-card:not(.ps-card--sk)')).toHaveCount(1);
    await page.getByRole('button', { name: 'Открыть: Дельта Гонки' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByTestId('duration-hltb')).toHaveText('На HLTB не найдено');
    await dlg.getByLabel('Своя оценка, часов').fill('5');
    await dlg.getByRole('button', { name: 'Сохранить длительность' }).click();
    await expect(dlg.getByTestId('duration-now')).toContainText('≈ 5 ч');
    // игра ушла из бакета «неизвестно»: список перезагружен
    await page.keyboard.press('Escape');
    await expect(page.getByText('Ничего не найдено')).toBeVisible();
  });

  test('ошибка сервера при сохранении показывается и не теряет ввод', async ({ page, context, baseURL }) => {
    const mock = await open(page, context, baseURL as string);
    await page.getByRole('button', { name: 'Открыть: Альфа Экшен' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Своя оценка, часов').fill('15');
    mock.failNextMutation = 503;
    await dlg.getByRole('button', { name: 'Сохранить длительность' }).click();
    await expect(dlg.getByRole('alert')).toContainText('База данных недоступна');
    await expect(dlg.getByLabel('Своя оценка, часов')).toHaveValue('15');
    await dlg.getByRole('button', { name: 'Сохранить длительность' }).click();
    await expect(dlg.getByTestId('duration-now')).toContainText('≈ 15 ч');
  });
});
