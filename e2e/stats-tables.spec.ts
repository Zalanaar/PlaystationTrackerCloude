// П15.3: графики Статистики «Таблицей» — раскрываются по тапу/клавиатуре, цифры совпадают с графиком,
// 360 px без горизонтальной прокрутки страницы, axe во всех темах.
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';
import { open, TODAY } from './stats-mock';
import { settle } from './settle';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];

test('часы и трофеи: «Таблицей» раскрывается, строки по месяцам', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!);
  const hours = page.getByTestId('tab-hours');
  await expect(hours).toBeVisible();
  await expect(hours.getByRole('table')).toBeHidden();
  await hours.getByText('Таблицей').click();
  const t = hours.getByRole('table', { name: `Часы по месяцам, ${TODAY.year}` });
  await expect(t).toBeVisible();
  await expect(t.locator('tbody tr')).toHaveCount(12);
  await expect(t.getByRole('rowheader', { name: 'Январь' })).toBeVisible();
  // клавиатура: Enter на summary сворачивает
  await hours.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(t).toBeHidden();

  const tr = page.getByTestId('tab-trophies');
  await tr.getByText('Таблицей').click();
  const row = tr.getByRole('row', { name: /Март/ });
  await expect(row).toContainText('14');
  await expect(tr.getByRole('columnheader', { name: 'Платина' })).toBeVisible();
});

for (const w of [360, 390]) {
  test(`${w} px: таблица не раздвигает страницу; axe во всех темах`, async ({ page, context, baseURL, isMobile }) => {
    test.skip(!isMobile, 'телефон');
    await page.setViewportSize({ width: w, height: 800 });
    await open(page, context, baseURL!);
    const tr = page.getByTestId('tab-trophies');
    await tr.getByText('Таблицей').click();
    await expect(tr.getByRole('table')).toBeVisible();
    expect((await tr.locator('summary').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.evaluate(axeSource);
    for (const t of THEMES) {
      await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
      await settle(page);
      const run = () => page.evaluate(async () => {
        const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
        const r = await ax.run({ include: [['[data-testid="tab-trophies"]'], ['[data-testid="tab-hours"]']] }, { resultTypes: ['violations'] });
        return r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      });
      let v = await run();
      if (v.length) { await page.waitForTimeout(1000); v = await run(); }
      expect(v, t).toEqual([]);
    }
  });
}
