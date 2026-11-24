// П13.4: «Первая неделя» на главной — пункты по ответу API (готовые отмечены), ссылки и действия (Разбор, тема в sheet),
// «Скрыть» насовсем (POST, cookie ps-week1=0), место под карточку по cookie без сдвига, 360/390 px и axe. API эмулируется.
import { createRequire } from 'node:module';
import { test, expect, type Page } from '@playwright/test';
import { mockApi, type Mock } from './collection-mock';
import { signedSession } from './session';
import { isMobile } from './backlog-ui';
import { expandToday } from './today';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps5'];
const SHOW = {
  show: true, endsAt: new Date(Date.now() + 5 * 86_400_000 - 3600_000).toISOString(),
  items: { sync: true, statuses: { count: 2, goal: 5, done: false }, hltb: false, monthGoals: false },
};

async function open(page: Page, baseURL: string, o: { body?: Record<string, unknown> | null; hint?: '1' | '0'; gate?: Promise<void> } = {}): Promise<Mock> {
  const cookies = [{ name: 'pst_session', value: await signedSession(), url: baseURL }, { name: 'ps-today-open', value: '1', url: baseURL }];
  if (o.hint) cookies.push({ name: 'ps-week1', value: o.hint, url: baseURL });
  await page.context().addCookies(cookies);
  const m = await mockApi(page);
  m.checklist = o.body === undefined ? SHOW : o.body;
  if (o.gate) {
    const gate = o.gate;
    await page.route(/\/api\/me\/checklist(\?|$)/, async (r) => { await gate; await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: m.checklist }) }); });
  }
  await page.goto('/');
  await expandToday(page);
  return m;
}
const hintCookie = async (page: Page) => (await page.context().cookies()).find((c) => c.name === 'ps-week1')?.value;

test.describe('П13.4: «Первая неделя»', () => {
  test('пункты, ссылки, тема в sheet', async ({ page, baseURL }) => {
    await open(page, baseURL!);
    const card = page.getByTestId('week1');
    await expect(card.getByRole('heading', { name: 'Первая неделя' })).toBeVisible();
    await expect(card.getByTestId('week1-progress')).toContainText('ещё 5 дн.');
    await expect(card.locator('[data-item="sync"]')).toHaveAttribute('data-done', 'true');
    await expect(card.locator('[data-item="sync"]')).toContainText('Синк с PSN готов');
    await expect(card.getByRole('link', { name: /Расставь статусы · 2 из 5/ })).toHaveAttribute('href', '/triage');
    await expect(card.getByRole('link', { name: /Время прохождения/ })).toHaveAttribute('href', '/backlog');
    const total = await card.locator('[data-item]').count();
    expect(total === 5 || total === 6).toBe(true);
    await expect(card.getByTestId('week1-progress')).toContainText(`1 из ${total}`);
    await expect.poll(() => hintCookie(page)).toBe('1');

    await card.getByRole('button', { name: 'Выбери тему' }).click();
    const sheet = page.getByRole('dialog', { name: 'Тема' });
    await sheet.getByRole('radio').nth(1).click();
    await sheet.getByRole('button', { name: 'Готово' }).click();
    await expect(card.locator('[data-item="theme"]')).toHaveAttribute('data-done', 'true');
    await expect(card.getByTestId('week1-progress')).toContainText(`2 из ${total}`);
  });

  test('«Скрыть» — насовсем: POST, cookie 0, после перезагрузки нет', async ({ page, baseURL }) => {
    const m = await open(page, baseURL!);
    const card = page.getByTestId('week1');
    await card.getByRole('button', { name: 'Скрыть «Первую неделю»' }).click();
    await expect(card).toHaveCount(0);
    await expect.poll(() => m.checklistDismissCalls).toBe(1);
    expect(await hintCookie(page)).toBe('0');
    await page.reload();
    await expect(page.locator('.ps-week1')).toHaveCount(0);
  });

  test('cookie-подсказка: скелет той же высоты, без сдвига; без подсказки и без показа — ничего', async ({ page, baseURL }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    await open(page, baseURL!, { hint: '1', gate });
    const box = page.locator('.ps-week1');
    await expect(box).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('.ps-card:not(.ps-card--sk), .ps-row').first()).toBeVisible(); // остальная страница уже на месте
    await page.waitForTimeout(300);
    const before = (await box.boundingBox())!;
    release();
    await expect(page.getByTestId('week1')).toBeVisible();
    const after = (await page.getByTestId('week1').boundingBox())!;
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  });

  test('неделя прошла — карточки нет, cookie 0', async ({ page, baseURL }) => {
    await open(page, baseURL!, { body: { show: false, endsAt: null, items: null }, hint: '1' });
    await expect.poll(() => hintCookie(page)).toBe('0');
    await expect(page.locator('.ps-week1')).toHaveCount(0);
  });

  for (const w of [360, 390]) {
    test(`${w} px: без скролла, высота, axe во всех темах`, async ({ page, baseURL }) => {
      test.skip(!isMobile(page), 'телефон');
      await page.setViewportSize({ width: w, height: 800 });
      await open(page, baseURL!);
      const card = page.getByTestId('week1');
      await expect(card).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      expect(Math.round((await card.boundingBox())!.height)).toBe(124);
      const hs = await card.locator('.ps-week1__item').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
      expect(Math.min(...hs)).toBeGreaterThanOrEqual(44);
      await page.evaluate(axeSource);
      for (const t of THEMES) {
        await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
        await page.waitForTimeout(500); // смена темы (WebKit)
        const v = await page.evaluate(async () => {
          const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
          const r = await ax.run({ include: [['.ps-week1']] }, { resultTypes: ['violations'] });
          return r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`);
        });
        expect(v, t).toEqual([]);
      }
    });
  }
});
