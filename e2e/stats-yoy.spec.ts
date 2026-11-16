// П11.3 «Год к году»: строка под шапкой периода (год и месяц), запрос прошлого года помечен yoy=1; нет прошлого года — строки нет;
// телефон 360/390: без горизонтального скролла, место занято сразу (CLS 0 при подмене скелета).
import { test, expect } from '@playwright/test';
import { open, TODAY } from './stats-mock';

test('год: строка сравнения с прошлым годом, запрос yoy=1', async ({ page, context, baseURL }) => {
  const ctl = await open(page, context, baseURL!);
  const yoy = page.getByTestId('yoy');
  await expect(yoy).toContainText(TODAY.month === 1 ? `К январю ${TODAY.year - 1}` : `К янв–`);
  await expect(yoy).toContainText('пройдено');
  await expect(yoy).toContainText('платины');
  // dev StrictMode может оборвать и повторить запрос: проверяем, что спрашивается только прошлый год
  expect([...new Set(ctl.yoyCalls.map((u) => u.searchParams.get('year')))]).toEqual([String(TODAY.year - 1)]);
  expect(ctl.calls.every((u) => u.searchParams.get('yoy') === null)).toBe(true);
});

test('прошлый год: тот же год целиком; месяц: тот же месяц прошлого года', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, `/stats?period=month&year=${TODAY.year}&month=3`);
  await expect(page.getByTestId('yoy')).toContainText(`К марте ${TODAY.year - 1}`);
  // март прошлого года в моке: 1 пройдена, 1 брошена, 2 платины — как и в этом
  await expect(page.getByTestId('yoy')).toContainText('пройдено 0');
});

test('нет прошлого года в years — строки нет', async ({ page, context, baseURL }) => {
  await open(page, context, baseURL!, `/stats?period=year&year=${TODAY.year - 1}`);
  await expect(page.getByRole('heading', { level: 2, name: String(TODAY.year - 1) })).toBeVisible();
  await expect(page.getByTestId('yoy')).toHaveCount(0);
});

for (const w of [360, 390]) {
  test(`${w} px: без горизонтального скролла, CLS 0`, async ({ page, context, baseURL, isMobile }) => {
    test.skip(!isMobile, 'телефон');
    await page.setViewportSize({ width: w, height: 800 });
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value; })
        .observe({ type: 'layout-shift', buffered: true });
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    // маршрут-заслонка должен стоять после мока stats-mock (последний зарегистрированный срабатывает первым)
    await open(page, context, baseURL!, '/backlog');
    await page.route(/\/api\/stats\?.*yoy=1/, async (r) => { await gate; await r.fallback(); });
    await page.goto('/stats');
    const yoy = page.getByTestId('yoy');
    await expect(yoy).toHaveAttribute('aria-busy', 'true');
    const before = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    release();
    await expect(yoy).toContainText('платины');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(after - before).toBeLessThan(0.001);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
