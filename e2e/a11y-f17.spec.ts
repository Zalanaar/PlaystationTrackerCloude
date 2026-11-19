// F17 (аудит UX): VoiceOver и Voice Control — aria-label начинается с видимого текста (axe label-content-name-mismatch),
// без aria-label на span (aria-prohibited-attr), порядок заголовков (heading-order) на «Плане», «Статистике», Коллекции и «Профилях».
import { createRequire } from 'node:module';
import { test, expect, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { baseState, mockRoadmap } from './roadmap-mock';
import { open as openStats } from './stats-mock';
import { setup as setupProfiles, TWO } from './profiles-mock';
import { signedSession } from './session';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const RULES = ['label-content-name-mismatch', 'aria-prohibited-attr', 'heading-order'];

async function check(page: Page): Promise<string[]> {
  await page.evaluate(axeSource);
  return page.evaluate(async (rules) => {
    const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await ax.run(document, { runOnly: { type: 'rule', values: rules }, rules: { 'label-content-name-mismatch': { enabled: true } }, resultTypes: ['violations'] });
    return r.violations.flatMap((x) => x.nodes.map((n) => `${x.id}: ${n.target.join(' ')}`));
  }, RULES);
}
async function login(page: Page, baseURL: string) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
}

test.describe('F17: имена совпадают с видимым текстом, порядок заголовков', () => {
  test('/roadmap', async ({ page, baseURL }) => {
    await login(page, baseURL!);
    await mockApi(page, []);
    await mockRoadmap(page, baseState());
    await page.goto('/roadmap');
    await expect(page.locator('.ps-skeleton')).toHaveCount(0, { timeout: 15_000 });
    expect(await check(page)).toEqual([]);
    // все виды таймлайна (месяцы, полосы)
    const seg = page.getByRole('group', { name: 'Вид таймлайна' }).getByRole('button');
    for (let i = 0; i < await seg.count(); i++) {
      await seg.nth(i).click();
      await page.waitForTimeout(300);
      expect(await check(page), await seg.nth(i).innerText()).toEqual([]);
    }
  });

  test('/stats', async ({ page, context, baseURL }) => {
    await openStats(page, context, baseURL!);
    await expect(page.locator('.ps-st-bar').first()).toBeVisible();
    await page.waitForTimeout(800);
    expect(await check(page)).toEqual([]);
  });

  test('/ (Коллекция, другие платформы)', async ({ page, baseURL }) => {
    await login(page, baseURL!);
    await mockApi(page, seed());
    await page.goto('/');
    await expect(page.locator('.ps-card:not(.ps-card--sk)').first()).toBeVisible();
    await page.getByTestId('op-block').scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    expect(await check(page)).toEqual([]);
  });

  test('/profiles', async ({ page, baseURL }) => {
    await setupProfiles(page, baseURL!, TWO());
    await page.goto('/profiles');
    await page.getByRole('heading', { level: 1, name: 'Профили PSN' }).waitFor();
    await page.waitForTimeout(800);
    expect(await check(page)).toEqual([]);
  });
});
