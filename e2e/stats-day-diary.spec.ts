// П11.1 «Дневник дня»: тап по дню карты «Активность» открывает игры, трофеи и завершения дня; ‹ › — соседние игровые дни;
// Enter с клавиатуры; закрытие; телефон 360/390 без горизонтального скролла; axe (контраст, имена) во всех темах.
import { createRequire } from 'node:module';
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { respond } from './stats-mock';
import { signedSession } from './session';

const axeSource: string = createRequire(import.meta.url)('axe-core').source;
const THEMES = ['night', 'graphite', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5'];

const shift = (date: string, n: number) => new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + n)).toISOString().slice(0, 10);

function dayFor(date: string) {
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  return {
    date, today, known: true, minutes: 95,
    games: [
      { id: 1, title: 'Очень длинное название игры, которое не помещается в строку телефона целиком', coverUrl: null, minutes: 60 },
      { id: 2, title: 'Вторая игра', coverUrl: null, minutes: 35 },
    ],
    trophies: {
      counts: { platinum: 1, gold: 0, silver: 0, bronze: 2, total: 3 },
      items: [
        { id: 11, type: 'platinum', name: 'Платиновый трофей', iconUrl: null, game: { id: 1, title: 'Игра' } },
        { id: 12, type: 'bronze', name: 'Бронза', iconUrl: null, game: null },
      ],
    },
    finished: [{ id: 2, title: 'Вторая игра', coverUrl: null, kind: 'completed' }],
    prev: shift(date, -2), next: date < today ? shift(date, 1) : null,
  };
}

async function open(page: Page, baseURL: string) {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockApi(page);
  await page.route(/\/api\/stats\?/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: respond(new URL(r.request().url())) }) }));
  const calls: string[] = [];
  await page.route(/\/api\/stats\/day(\?|$)/, (r) => {
    const date = new URL(r.request().url()).searchParams.get('date')!;
    calls.push(date);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: dayFor(date) }) });
  });
  await page.goto('/stats');
  const panel = page.getByRole('region', { name: 'Активность' });
  await panel.scrollIntoViewIfNeeded();
  const cell = panel.locator('.ps-heat__c[data-l="4"]').last();
  await expect(cell).toBeAttached();
  return { panel, cell, calls };
}

test('тап по дню: дневник, соседние дни, закрытие', async ({ page, baseURL }) => {
  const { panel, cell, calls } = await open(page, baseURL!);
  const label = (await cell.getAttribute('aria-label'))!;
  await cell.click();
  const diary = panel.getByTestId('day-diary');
  await expect(diary).toBeVisible();
  await expect(cell).toHaveAttribute('aria-selected', 'true');
  await expect(diary.getByRole('heading', { level: 4 })).toHaveText(label.split(':')[0]);
  await expect(diary.getByTestId('day-summary')).toHaveText('1 ч 35 м · 2 игры · +3 трофея · пройдена 1');
  await expect(diary.getByTestId('day-game')).toHaveCount(2);
  await expect(diary.getByTestId('day-game').first()).toContainText('1 ч');
  await expect(diary.getByTestId('day-trophy')).toHaveCount(2);
  await expect(diary.getByTestId('day-finished')).toContainText('Пройдена');
  await expect(diary.getByText('Трофеи: 3 · 1 платина · 2 бронзы')).toBeVisible();
  const first = calls[0];
  await diary.getByRole('button', { name: 'Предыдущий игровой день' }).click();
  await expect.poll(() => calls.at(-1)).toBe(shift(first, -2));
  await expect(diary.getByTestId('day-summary')).toBeVisible();
  await diary.getByRole('button', { name: 'Следующий игровой день' }).click();
  await expect.poll(() => calls.at(-1)).toBe(shift(first, -1));
  await diary.getByRole('button', { name: 'Закрыть дневник дня' }).click();
  await expect(diary).toHaveCount(0);
});

test('клавиатура: Enter на дне открывает дневник', async ({ page, baseURL, isMobile }) => {
  test.skip(isMobile, 'клавиатура');
  const { panel } = await open(page, baseURL!);
  const stop = panel.locator('.ps-heat__c[tabindex="0"]');
  await stop.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(panel.getByTestId('day-diary')).toBeVisible();
  await expect(panel.getByTestId('day-game')).toHaveCount(2);
});

for (const w of [360, 390]) {
  test(`${w} px: дневник без горизонтального скролла, axe во всех темах`, async ({ page, baseURL, isMobile }) => {
    test.skip(!isMobile, 'телефон');
    await page.setViewportSize({ width: w, height: 800 });
    const { panel, cell } = await open(page, baseURL!);
    await cell.click();
    const diary = panel.getByTestId('day-diary');
    await expect(diary.getByTestId('day-game')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const box = await diary.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(w);
    // строки не шире дневника: минуты и «Пройдена» видны (длинное название обрезается многоточием)
    for (const v of await diary.locator('.ps-day__v').all()) {
      const r = (await v.boundingBox())!;
      expect(r.x + r.width).toBeLessThanOrEqual(box!.x + box!.width);
    }
    for (const b of await diary.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(32);
    await page.evaluate(axeSource);
    for (const t of THEMES) {
      await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
      await page.waitForTimeout(300);
      const v = await page.evaluate(async () => {
        const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
        const r = await ax.run({ include: [['[data-testid="day-diary"]']], exclude: [['.ps-cover']] }, { resultTypes: ['violations'] });
        return r.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      });
      expect(v, t).toEqual([]);
    }
  });
}
