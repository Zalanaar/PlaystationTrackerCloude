// Фаза 48 (п. 13–15): axe-core на экранах коллекции поверх моков (e2e/collection-mock.ts), БД не нужна.
// axe-core подключается исходником (`axe.source`) прямо в страницу, без @axe-core/playwright.
import { createRequire } from 'node:module';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'] as const;

async function open(page: Page, context: BrowserContext, baseURL: string, url: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockApi(page, seed());
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeAttached();
  await expect(page.getByRole('group', { name: 'Статус' }).getByRole('button', { name: /^Все/ })).toContainText(/\d/);
}

type Node = { target: string[]; failureSummary?: string };
/** Нарушения выбранных правил; `exclude` = селекторы, которые не проверяются (обложки-заглушки моков). */
async function axe(page: Page, rules: string[], exclude: string[] = []): Promise<Record<string, Node[]>> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(axeSource); // evaluate идёт мимо CSP страницы (inline-скрипт она блокирует)
  return page.evaluate(async ({ rules, exclude }) => {
    const w = window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: Node[] }[] }> } };
    const r = await w.axe.run({ include: [['body']], exclude: exclude.map((s) => [s]) }, { runOnly: { type: 'rule', values: rules }, resultTypes: ['violations'] });
    return Object.fromEntries(r.violations.map((v) => [v.id, v.nodes.map((n) => ({ target: n.target, failureSummary: n.failureSummary }))]));
  }, { rules, exclude });
}

async function setTheme(page: Page, t: (typeof THEMES)[number]) {
  await page.evaluate((t) => {
    if (t === 'night') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }, t);
  // переходы цвета между темами: мерить после них
  await page.waitForTimeout(400);
}

// Обложки в моках = заглушки (плитка с названием поверх случайного цвета): их контраст не про тему
const COVERS = ['.ps-cover', '.ps-hero__art', '.ps-card__cover', '.ps-hero__main'];

test.describe('Фаза 48 (п. 13): контраст вторичного текста во всех темах', () => {
  for (const url of ['/', '/?view=list', '/?status=completed']) {
    test(`${url}: color-contrast без нарушений в 7 темах`, async ({ page, context, baseURL }) => {
      await open(page, context, baseURL!, url);
      const bad: Record<string, string[]> = {};
      for (const t of THEMES) {
        await setTheme(page, t);
        const v = await axe(page, ['color-contrast'], COVERS);
        if (v['color-contrast']?.length) bad[t] = v['color-contrast'].map((n) => `${n.target.join(' ')}: ${n.failureSummary?.split('\n').at(-1)?.trim()}`);
      }
      expect(bad).toEqual({});
    });
  }
});
