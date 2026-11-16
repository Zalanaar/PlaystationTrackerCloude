// П12.6: «Релизы в календарь (.ics)» под блоком «Релизы» плана — только при будущих релизах, обычная ссылка на файл
// (десктоп скачивает releases.ics), 360 px без скролла, высота 44 на телефоне, axe во всех темах.
import { createRequire } from 'node:module';
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { baseState, mockRoadmap, type RmPlanned } from './roadmap-mock';
import { signedSession } from './session';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];
const day = (d: number) => new Date(Date.now() + 3 * 3600_000 + d * 86_400_000).toISOString().slice(0, 10);
const rel = (id: number, title: string, date: string | null, o: Partial<RmPlanned> = {}): RmPlanned => ({
  id, title, releaseDate: date, coverUrl: null, wantAtRelease: false, hoursManual: null, externalSource: null, externalId: null, status: 'planned', ...o,
});

async function open(page: Page, baseURL: string, planned: RmPlanned[]) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, []);
  await mockRoadmap(page, baseState({ planned }));
  await page.route('**/api/roadmap/releases.ics', (r) => r.fulfill({
    status: 200, body: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n',
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="releases.ics"' },
  }));
  await page.goto('/roadmap');
  await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
  await page.getByRole('heading', { name: /^Релизы/, level: 2 }).waitFor();
}

test('есть будущий релиз: ссылка на .ics; десктоп скачивает файл', async ({ page, baseURL, isMobile, browserName }) => {
  await open(page, baseURL!, [rel(1, 'Будущая игра', day(30), { wantAtRelease: true }), rel(2, 'Без даты', null)]);
  const a = page.getByTestId('rm-ics');
  await expect(a).toBeVisible();
  await expect(a).toHaveAttribute('href', '/api/roadmap/releases.ics');
  await expect(a).toHaveText('Релизы в календарь (.ics)');
  test.skip(isMobile || browserName !== 'chromium', 'скачивание проверяем на десктопе');
  const [dl] = await Promise.all([page.waitForEvent('download'), a.click()]);
  expect(dl.suggestedFilename()).toBe('releases.ics');
});

test('только вышедшие и без даты — ссылки нет', async ({ page, baseURL }) => {
  await open(page, baseURL!, [rel(1, 'Вышла', day(-3)), rel(2, 'Без даты', null)]);
  await expect(page.getByRole('heading', { name: /^Релизы/, level: 2 })).toBeVisible();
  await expect(page.getByTestId('rm-ics')).toHaveCount(0);
});

for (const w of [360, 390]) {
  test(`${w} px: без горизонтального скролла, высота 44, axe во всех темах`, async ({ page, baseURL, isMobile }) => {
    test.skip(!isMobile, 'телефон');
    await page.setViewportSize({ width: w, height: 800 });
    await open(page, baseURL!, [rel(1, 'Будущая игра с длинным названием для проверки строки', day(10))]);
    const a = page.getByTestId('rm-ics');
    await a.scrollIntoViewIfNeeded();
    expect((await a.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.evaluate(axeSource);
    for (const t of THEMES) {
      await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
      await page.waitForTimeout(300);
      const v = await page.evaluate(async () => {
        const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
        const r = await ax.run({ include: [['.ps-rm-ics']] }, { resultTypes: ['violations'] });
        return r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      });
      expect(v, t).toEqual([]);
    }
  });
}
