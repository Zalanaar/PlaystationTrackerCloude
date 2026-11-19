// П13.2: свои теги. Окно игры: «Добавить тег», переключатели и новый тег (POST, затем PUT). Коллекция: `?tag=ID` — плоский список
// игр с тегом (сортировка по названию — плоский список и без тега), чип «#Тег ×» снимает фильтр. Sheet «Теги» из меню коллекции: выбор, переименование, удаление. 360 px и axe. API эмулируется.
import { createRequire } from 'node:module';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G, type Mock } from './collection-mock';
import { settle } from './settle';
import { signedSession } from './session';
import { isMobile } from './backlog-ui';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps5'];

const g = (id: number, title: string): G => ({
  id, title, lastPlayedAt: `2026-09-0${id}T10:00:00.000Z`, status: 'backlog', completedAt: null, droppedAt: null, playSeconds: 3600, playCount: 1, trophies: null,
});
const games = (): G[] => [g(1, 'Альфа Игра'), g(2, 'Бета Кооп'), g(3, 'Гамма Кооп'), g(4, 'Дельта Игра')];

async function open(page: Page, context: BrowserContext, baseURL: string, url: string, setup: (m: Mock) => void = () => {}): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, games());
  mock.tags = [{ id: 1, name: 'Кооп' }];
  mock.gameTags = { 2: [1], 3: [1] };
  setup(mock);
  await page.goto(url);
  return mock;
}
const titles = async (page: Page) => (await page.locator('.ps-card:not(.ps-card--sk) .ps-card__title, .ps-row__title').allTextContents()).sort();
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function axe(page: Page, sel: string) {
  await page.evaluate(axeSource);
  for (const t of THEMES) {
    await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
    await settle(page); // смена темы / sheet (WebKit): ждём конца переходов, иначе axe меряет контраст посреди перехода
    const run = () => page.evaluate(async (s) => {
      const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
      const r = await ax.run({ include: [[s]] }, { resultTypes: ['violations'] });
      return r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    }, sel);
    let v = await run();
    if (v.length) { await page.waitForTimeout(1000); v = await run(); }
    expect(v, t).toEqual([]);
  }
}

async function openTagsFromFilters(page: Page) {
  await page.getByRole('button', { name: /^Фильтры и сортировка/ }).click();
  await page.getByTestId('filters-tags').click();
  const sheet = page.getByRole('dialog', { name: 'Теги' });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function openTagsSheet(page: Page) {
  if (isMobile(page)) {
    // F13: «Теги» — в меню «⋯» шапки
    await page.getByRole('button', { name: 'Меню', exact: true }).click();
    await page.getByTestId('sheet-tags').click();
  } else {
    await page.getByRole('button', { name: 'Ещё: действия с коллекцией' }).click();
    await page.getByTestId('menu-tags').click();
  }
  const sheet = page.getByRole('dialog', { name: 'Теги' });
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe('П13.2: теги', () => {
  test('окно игры: повесить тег и создать новый', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, '/?game=1');
    const d = page.getByRole('dialog', { name: 'Альфа Игра' });
    const sec = d.getByTestId('gd-tags');
    await expect(sec.getByText('Своих списков у игры нет')).toBeVisible();
    await sec.getByRole('button', { name: 'Добавить тег' }).click();
    const opt = sec.getByRole('group', { name: 'Теги игры' }).getByRole('button', { name: 'Кооп' });
    await opt.click();
    await expect(opt).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => m.mutations.filter((x) => x.url.endsWith('/games/1/tags')).map((x) => x.body)).toContainEqual({ tagIds: [1] });
    await sec.getByRole('textbox', { name: 'Новый тег' }).fill('Перепройти');
    await sec.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect.poll(() => m.gameTags[1]).toEqual([1, 2]);
    await sec.getByRole('button', { name: 'Готово' }).click();
    await expect(sec.getByTestId('gd-tag')).toHaveText(['#Кооп', '#Перепройти']);
    await expect(sec.getByTestId('gd-tag').first()).toHaveAttribute('href', '/?tag=1');
    // дубль имени — понятная ошибка
    await sec.getByRole('button', { name: 'Изменить' }).click();
    await sec.getByRole('textbox', { name: 'Новый тег' }).fill('кооп');
    await sec.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(sec.getByRole('alert')).toHaveText('Такой тег уже есть.');
  });

  test('коллекция: ?tag= — только игры с тегом, чип снимает фильтр', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, '/?sort=title&tag=1');
    await expect.poll(() => titles(page)).toEqual(['Бета Кооп', 'Гамма Кооп']);
    expect(m.listCalls.some((u) => u.searchParams.get('tag') === '1')).toBe(true);
    const chip = page.getByTestId('tag-chip');
    await expect(chip).toHaveText(/#Кооп/);
    await chip.click();
    await expect(page).not.toHaveURL(/tag=/);
    await expect.poll(() => titles(page)).toHaveLength(4);
  });

  test('sheet «Теги»: выбрать, переименовать, удалить', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, '/?sort=title');
    await expect.poll(() => titles(page)).toHaveLength(4);
    let sheet = await openTagsSheet(page);
    await expect(sheet.getByTestId('tag-row')).toHaveCount(1);
    await expect(sheet.getByTestId('tag-row')).toContainText('2 игры');
    await sheet.getByRole('button', { name: /#Кооп/ }).click();
    await expect(page).toHaveURL(/tag=1/);
    await expect.poll(() => titles(page)).toEqual(['Бета Кооп', 'Гамма Кооп']);

    // на телефоне теги и из листа «Фильтры» (не только из «⋯»), с пометкой выбранного
    if (isMobile(page)) {
      sheet = await openTagsFromFilters(page);
    } else sheet = await openTagsSheet(page);
    await sheet.getByRole('button', { name: 'Переименовать тег Кооп' }).click();
    await sheet.getByRole('textbox', { name: 'Новое название тега Кооп' }).fill('Вдвоём');
    await sheet.getByRole('button', { name: 'Сохранить' }).click();
    await expect(sheet.getByRole('button', { name: /#Вдвоём/ })).toBeVisible();
    expect(m.mutations.some((x) => x.method === 'PATCH' && x.url.endsWith('/api/tags/1'))).toBe(true);

    await sheet.getByRole('button', { name: 'Удалить тег Вдвоём' }).click();
    await sheet.getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(sheet.getByText('Тегов пока нет. Создай первый ниже.')).toBeVisible();
    await expect(page).not.toHaveURL(/tag=/);
    expect(m.mutations.some((x) => x.method === 'DELETE' && x.url.endsWith('/api/tags/1'))).toBe(true);
  });

  for (const w of [360, 390]) {
    test(`${w} px: без скролла, axe во всех темах (окно игры и sheet)`, async ({ page, context, baseURL }) => {
      test.skip(!isMobile(page), 'телефон');
      await page.setViewportSize({ width: w, height: 800 });
      await open(page, context, baseURL!, '/?game=2', (m) => { m.tags = [{ id: 1, name: 'Кооп' }, { id: 2, name: 'Очень длинное название тега тут' }]; m.gameTags = { 2: [1, 2] }; });
      const sec = page.getByRole('dialog', { name: 'Бета Кооп' }).getByTestId('gd-tags');
      await expect(sec.getByTestId('gd-tag')).toHaveCount(2);
      await sec.getByRole('button', { name: 'Изменить' }).click();
      await sec.scrollIntoViewIfNeeded();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await axe(page, '.ps-gtags');
      await page.goto('/');
      const sheet = await openTagsSheet(page);
      await expect(sheet.getByTestId('tag-row')).toHaveCount(2);
      await expect.poll(() => sheet.evaluate((el) => getComputedStyle(el.closest('.ps-sheet') ?? el).opacity)).toBe('1');
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await axe(page, '.ps-tags');
    });
  }
});
