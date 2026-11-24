// П13.3: цена покупки в окне игры (указать, неверный ввод, убрать, «сыграно меньше часа»). Раздел «Стоимость часа» в Статистике убран. 360 px и axe. API эмулируется.
import { createRequire } from 'node:module';
import { test, expect, type Page } from '@playwright/test';
import { mockApi, type G, type Mock } from './collection-mock';
import { settle } from './settle';
import { signedSession } from './session';
import { isMobile } from './backlog-ui';
import { statsAll } from './stats-all-fixture';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps5'];
const S = '[\\s\\u00a0\\u202f]';

const g = (id: number, title: string, playSeconds: number): G => ({
  id, title, lastPlayedAt: `2026-09-0${id}T10:00:00.000Z`, status: 'backlog', completedAt: null, droppedAt: null, playSeconds, playCount: 1, trophies: null,
});
const games = (): G[] => [g(1, 'Долгая Игра', 40 * 3600), g(2, 'Короткий Запуск', 1800)];

async function open(page: Page, baseURL: string, url: string, setup: (m: Mock) => void = () => {}): Promise<Mock> {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const m = await mockApi(page, games());
  setup(m);
  await page.route(/\/api\/stats\?/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: statsAll({}) }) }));
  await page.goto(url);
  return m;
}

const COST = {
  priced: 3, total: 9000, hours: 100.5, perHour: 90,
  best: [{ id: 1, title: 'Долгая Игра', price: 4000, hours: 40, perHour: 100 }, { id: 3, title: 'Подписка', price: 0, hours: 60, perHour: 0 }],
  worst: [],
  idle: { count: 1, total: 5000 },
};

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

test.describe('П13.3: стоимость часа', () => {
  test('окно игры: указать цену, неверный ввод, убрать', async ({ page, baseURL }) => {
    const m = await open(page, baseURL!, '/?game=1');
    const sec = page.getByRole('dialog', { name: 'Долгая Игра' }).getByTestId('gd-price');
    await expect(sec.getByTestId('gd-price-line')).toHaveText('Не указана');
    await sec.getByRole('button', { name: 'Указать цену' }).click();
    const input = sec.getByRole('textbox', { name: 'Цена, ₽' });
    await input.fill('abc');
    await expect(sec.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    await input.fill('4 000');
    await sec.getByRole('button', { name: 'Сохранить' }).click();
    await expect(sec.getByTestId('gd-price-line')).toHaveText(new RegExp(`^Куплена за 4${S}000 ₽ · час стоит 100 ₽/ч$`));
    expect(m.mutations.filter((x) => x.url.endsWith('/games/1/price')).map((x) => x.body)).toEqual([{ price: 4000 }]);
    await sec.getByRole('button', { name: 'Убрать' }).click();
    await expect(sec.getByTestId('gd-price-line')).toHaveText('Не указана');
    expect(m.prices[1]).toBeUndefined();
  });

  test('окно игры: меньше часа — без стоимости часа', async ({ page, baseURL }) => {
    await open(page, baseURL!, '/?game=2', (m) => { m.prices = { 2: 2000 }; });
    const sec = page.getByRole('dialog', { name: 'Короткий Запуск' }).getByTestId('gd-price');
    await expect(sec.getByTestId('gd-price-line')).toHaveText(new RegExp(`^Куплена за 2${S}000 ₽ · сыграно меньше часа$`));
  });

  test('статистика: раздела «Стоимость часа» нет, старый ?sec=cost не ломает страницу', async ({ page, baseURL }) => {
    await open(page, baseURL!, '/stats?period=all&sec=cost', (m) => { m.cost = COST; });
    await expect(page.getByRole('heading', { name: 'Статистика' })).toBeVisible();
    await expect(page.locator('.ps-cost')).toHaveCount(0);
    await expect(page.getByTestId('stats-sections').locator('[data-sec="cost"]')).toHaveCount(0);
    await expect(page.getByTestId('stats-sections').locator('[data-sec="time"]')).toHaveText('Время');
  });

  for (const w of [360, 390]) {
    test(`${w} px: без скролла, axe во всех темах`, async ({ page, baseURL }) => {
      test.skip(!isMobile(page), 'телефон');
      await page.setViewportSize({ width: w, height: 800 });
      await open(page, baseURL!, '/?game=1', (m) => { m.prices = { 1: 4000 }; });
      const sec = page.getByRole('dialog', { name: 'Долгая Игра' }).getByTestId('gd-price');
      await expect(sec.getByTestId('gd-price-line')).toContainText('час стоит 100 ₽/ч');
      await sec.getByRole('button', { name: 'Изменить' }).click();
      await sec.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      await axe(page, '.ps-gprice');
    });
  }
});
