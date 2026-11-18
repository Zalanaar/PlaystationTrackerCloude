// П14.1 «Сравнение профилей» на /profiles: только при двух и более профилях; выбор, смена мест при совпадении, общие игры,
// сбой с «Повторить»; 360/390 px без горизонтального скролла, выбор 44 px, axe во всех темах.
import { createRequire } from 'node:module';
import { settle } from './settle';
import { test, expect, type Page } from '@playwright/test';
import { setup, ONE, TWO, THREE } from './profiles-mock';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];

async function open(page: Page) {
  await page.goto('/profiles');
  await page.getByRole('heading', { level: 1, name: 'Профили PSN' }).waitFor();
}
const cell = (page: Page, metric: string, i: number) => page.locator(`.ps-pcmp__t tr[data-metric="${metric}"] td`).nth(i);

test('один профиль — блока нет', async ({ page, baseURL }) => {
  await setup(page, baseURL!, ONE());
  await open(page);
  await expect(page.getByTestId('pcmp')).toHaveCount(0);
});

test('два профиля: цифры, «больше — жирным», общие игры', async ({ page, baseURL }) => {
  const s = await setup(page, baseURL!, TWO());
  await open(page);
  const box = page.getByTestId('pcmp');
  await expect(box.getByRole('heading', { name: 'Сравнение профилей' })).toBeVisible();
  await expect(page.getByTestId('pcmp-a')).toHaveValue('1');
  await expect(page.getByTestId('pcmp-b')).toHaveValue('2');
  await expect(cell(page, 'games', 0)).toHaveText('214');
  await expect(cell(page, 'games', 1)).toHaveText('12');
  await expect(cell(page, 'games', 0)).toHaveAttribute('data-lead', 'true');
  await expect(cell(page, 'ultra_rare', 0)).not.toHaveAttribute('data-lead', /.*/);
  expect(await cell(page, 'games', 0).evaluate((e) => Number(getComputedStyle(e).fontWeight))).toBeGreaterThanOrEqual(700);
  await expect(box.getByRole('heading', { name: /Общие игры/ })).toContainText('2');
  const games = page.getByTestId('pcmp-game');
  await expect(games).toHaveCount(2);
  await expect(games.first()).toContainText('Artem_PS: 120,5 ч · пройдена');
  await expect(games.first()).toContainText('Second_Nick: 14 ч · играю');
  await expect(games.nth(1)).toContainText('Artem_PS: не играл');
  // в dev React StrictMode запускает эффект дважды (первый запрос отменяется): проверяем, что спрашивали только пару 1–2
  expect(new Set(s.calls.filter((c) => c.startsWith('GET compare')))).toEqual(new Set(['GET compare 1 2']));
});

test('три профиля: выбор того же профиля меняет местами; общих нет', async ({ page, baseURL }) => {
  const s = await setup(page, baseURL!, THREE());
  await open(page);
  await expect(cell(page, 'games', 1)).toHaveText('12');
  await page.getByTestId('pcmp-b').selectOption('3');
  await expect(cell(page, 'games', 1)).toHaveText('0');
  await expect(page.getByTestId('pcmp')).toContainText('Общих игр пока нет.');
  await page.getByTestId('pcmp-a').selectOption('3');
  await expect(page.getByTestId('pcmp-a')).toHaveValue('3');
  await expect(page.getByTestId('pcmp-b')).toHaveValue('1');
  await expect(cell(page, 'games', 1)).toHaveText('214');
  expect(s.calls.filter((c) => c.startsWith('GET compare')).at(-1)).toBe('GET compare 3 1');
});

test('сбой: «Не удалось сравнить» и «Повторить»', async ({ page, baseURL }) => {
  const s = await setup(page, baseURL!, TWO(), { compareFail: true });
  await open(page);
  await expect(page.getByTestId('pcmp').getByRole('alert')).toContainText('Не удалось сравнить профили.');
  s.compareFail = false;
  await page.getByTestId('pcmp').getByRole('button', { name: 'Повторить' }).click();
  await expect(cell(page, 'games', 0)).toHaveText('214');
});

for (const w of [360, 390]) {
  test(`${w} px: без горизонтального скролла, выбор 44 px, axe во всех темах`, async ({ page, baseURL, isMobile }) => {
    test.skip(!isMobile, 'телефон');
    await page.setViewportSize({ width: w, height: 800 });
    await setup(page, baseURL!, TWO());
    await open(page);
    await expect(page.getByTestId('pcmp-game')).toHaveCount(2);
    for (const id of ['pcmp-a', 'pcmp-b']) expect((await page.getByTestId(id).boundingBox())!.height, id).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.evaluate(axeSource);
    for (const t of THEMES) {
      await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
      await settle(page);
      const run = () => page.evaluate(async () => {
        const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
        const r = await ax.run({ include: [['.ps-pcmp']] }, { resultTypes: ['violations'] });
        return r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      });
      let v = await run();
      if (v.length) { await page.waitForTimeout(1000); v = await run(); } // WebKit: контраст посреди перехода
      expect(v, t).toEqual([]);
    }
  });
}
