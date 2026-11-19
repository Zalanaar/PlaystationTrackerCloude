// П9 «Удобство»: на телефоне нет видимого текста мельче 12 px (подписи редкости, «Осталось», индикатор синхронизации, подписи графиков).
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { open as openStats } from './stats-mock';
import { signedSession } from './session';
import { baseState, mockRoadmap } from './roadmap-mock';

/** Видимые элементы со своим текстом мельче 12 px (aria-hidden и визуально скрытые не считаем). */
const small = (page: Page) => page.evaluate(() => {
  const out: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    if (el.closest('[aria-hidden="true"], .ps-sr, script, style, svg')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.clip === 'rect(0px, 0px, 0px, 0px)') continue;
    const fs = parseFloat(cs.fontSize);
    if (fs > 0 && fs < 12) out.push(`${el.className || el.tagName} «${el.textContent!.trim().slice(0, 24)}» ${cs.fontSize}`);
  }
  return [...new Set(out)];
});

test.beforeEach(({ isMobile }) => { test.skip(!isMobile, 'телефон'); });
test.use({ viewport: { width: 390, height: 844 } });

for (const url of ['/', '/?game=3', '/?game=3&tab=trophies', '/triage', '/backlog', '/trophies']) {
  test(`текст ≥ 12 px: ${url}`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    await mockApi(page);
    await page.goto(url);
    await page.locator('main').first().waitFor();
    await page.locator('.ps-skeleton').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    expect(await small(page)).toEqual([]);
  });
}

for (const url of ['/stats?period=year', '/stats?period=month&year=2026&month=10', '/stats?period=all']) {
  test(`текст ≥ 12 px: ${url}`, async ({ page, context, baseURL }) => {
    await openStats(page, context, baseURL!, url);
    await page.locator('main').first().waitFor();
    await page.locator('.ps-skeleton').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    // все разделы Статистики: прокрутить до конца, чтобы ленивые блоки отрисовались
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } });
    await page.waitForTimeout(300);
    expect(await small(page)).toEqual([]);
  });
}

test('вкладки внизу: подписи 12 px помещаются и при 360 px', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await mockApi(page);
  await page.goto('/');
  await page.locator('.ps-tab').first().waitFor();
  const cut = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.ps-tab')]
    .filter((t) => { const r = t.getBoundingClientRect(); return [...t.querySelectorAll('*'), t].some((e) => { const b = e.getBoundingClientRect(); return e.scrollWidth > e.clientWidth + 1 || b.left < r.left - 1 || b.right > r.right + 1; }); })
    .map((t) => t.textContent));
  expect(cut).toEqual([]);
});

// F15: подписи очереди «выходит … · 2 нед.» были 9,6 px (small в 12 px)
test('текст ≥ 12 px: /roadmap', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
  await mockApi(page, []);
  await mockRoadmap(page, baseState());
  await page.goto('/roadmap');
  await page.getByTestId('rm-queue-row').first().waitFor();
  await page.waitForTimeout(800);
  expect(await small(page)).toEqual([]);
});
