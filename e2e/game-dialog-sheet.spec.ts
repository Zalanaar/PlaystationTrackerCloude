// П17: окно игры на телефоне — лист ниже safe area (env(safe-area-inset-top) + 10 px): сверху видно затемнение (касание закрывает),
// скруглённые верхние углы и «ручка» в каждой теме, баннер внутри листа, ✕ ≥ 44 px ниже края листа; десктоп без изменений; axe во всех темах.
import { createRequire } from 'node:module';
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];
const setTheme = (page: Page, t: string) => page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);

async function open(page: Page, baseURL: string) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, seed());
  await page.goto('/?game=4');
  const d = page.getByRole('dialog', { name: 'God of War' });
  await expect(d.getByTestId('game-review')).toBeVisible();
  await page.waitForTimeout(500); // появление листа
  return d;
}
const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox())!;

test('телефон: лист ниже верхнего края, затемнение сверху, углы, ручка, баннер и ✕ внутри листа — во всех темах', async ({ page, baseURL, isMobile }) => {
  test.skip(!isMobile, 'телефон');
  await open(page, baseURL!);
  await page.evaluate(axeSource);
  for (const t of THEMES) {
    await setTheme(page, t);
    await page.waitForTimeout(200);
    const sheet = await box(page, '.ps-gd__sheet');
    expect(sheet.y, t).toBeGreaterThanOrEqual(8);
    expect(sheet.y, t).toBeLessThanOrEqual(12);
    // над листом — затемнение, а не содержимое окна
    expect(await page.evaluate(() => document.elementFromPoint(innerWidth / 2, 4)?.className), t).toContain('ps-gd__dim');
    const st = await page.locator('.ps-gd__sheet').evaluate((el) => { const c = getComputedStyle(el); return { r: parseFloat(c.borderTopLeftRadius), o: c.overflow }; });
    expect(st.r, t).toBeGreaterThan(0);
    expect(st.o, t).toBe('hidden');
    const grab = await box(page, '.ps-gd__grab');
    expect(grab.y, t).toBeGreaterThan(sheet.y);
    expect(grab.y - sheet.y, t).toBeLessThan(16);
    const art = await box(page, '.ps-gd__art');
    expect(art.y, t).toBeGreaterThanOrEqual(sheet.y - 0.5);
    const x = await box(page, '.ps-gd__close');
    expect(x.width, t).toBeGreaterThanOrEqual(44);
    expect(x.height, t).toBeGreaterThanOrEqual(44);
    expect(x.y - sheet.y, t).toBeGreaterThanOrEqual(12);
    expect(x.y, t).toBeGreaterThan(grab.y + grab.height);
    const v = await page.evaluate(async () => {
      const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
      const r = await ax.run({ include: [['.ps-gd']] }, { resultTypes: ['violations'] });
      return r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    });
    expect(v, t).toEqual([]);
  }
  expect(await page.locator('.ps-gd__sheet').evaluate((el) => getComputedStyle(el).top)).toBe('10px'); // env(safe-area-inset-top)=0 в эмуляции
});

test('телефон: касание затемнения над листом закрывает окно', async ({ page, baseURL, isMobile }) => {
  test.skip(!isMobile, 'телефон');
  const d = await open(page, baseURL!);
  await page.mouse.click(200, 4);
  await expect(d).toHaveCount(0);
  await expect(page).not.toHaveURL(/game=/);
});

test('десктоп: окно как раньше — лист во всё окно, без затемнения и ручки', async ({ page, baseURL, isMobile }) => {
  test.skip(!!isMobile, 'десктоп');
  await open(page, baseURL!);
  const sheet = await box(page, '.ps-gd__sheet');
  expect(sheet.y).toBe(0);
  await expect(page.locator('.ps-gd__dim')).toBeHidden();
  await expect(page.locator('.ps-gd__grab')).toBeHidden();
  expect(await page.locator('.ps-gd__sheet').evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('0px');
});
