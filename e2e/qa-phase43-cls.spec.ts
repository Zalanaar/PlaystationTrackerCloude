// QA Фазы 43 (QA-T-1): скачки макета Бэклога и Коллекции от новых элементов (чип «Это та игра?», записи «не куплено», кнопка «Добавить»).
import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { mgame, mockManual, type MMatch } from './manual-mock';
import { signedSession } from './session';

async function track(page: Page) {
  await page.addInitScript(() => {
    type LS = PerformanceEntry & { value: number; hadRecentInput: boolean };
    const w = window as unknown as { __ls: { t: number; v: number; n: string }[] };
    w.__ls = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as LS[]) if (!e.hadRecentInput) w.__ls.push({ t: Math.round(e.startTime), v: e.value, n: ((e as unknown as { sources?: { node?: Element }[] }).sources ?? []).map((x) => (x.node as HTMLElement | undefined)?.className?.toString().slice(0, 30) ?? '').join('|') });
    }).observe({ type: 'layout-shift', buffered: true });
  });
}
const read = (page: Page) => page.evaluate(() => (window as unknown as { __ls: { v: number; n: string }[] }).__ls);

const match: MMatch = { id: 1, title: 'Hades', coverUrl: null, notPurchased: true, game: { gameId: 9, name: 'Hades II', imageUrl: null, lastPlayedAt: '2026-10-30T10:00:00.000Z', hours: 2 } };

for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  for (const withNew of [false, true]) {
    test(`CLS Бэклога ${w}, новые данные Фазы 43: ${withNew}`, async ({ page, context, baseURL }, info) => {
      test.skip(info.project.name === 'mobile', 'размер задаётся вручную');
      await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
      const m = await mockApi(page);
      m.delayList = () => 1500;
      await mockManual(page, withNew ? { items: [mgame(1, 'Один'), mgame(2, 'Два')], matches: [match] } : {});
      // ответы Фазы 43 приходят позже списка: худший случай для сдвигов
      await page.route(/\/api\/manual-games(\/matches)?(\?[^/]*)?$/, async (r) => { await new Promise((ok) => setTimeout(ok, 1800)); await r.fallback(); });
      await track(page);
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/backlog');
      await expect(page.locator('.ps-bl-list, .ps-blrow').first()).toBeVisible();
      await page.waitForTimeout(2600);
      const ls = await read(page);
      const sum = ls.reduce((s, e) => s + e.v, 0);
      console.log(`CLS backlog ${w} new=${withNew}: ${sum.toFixed(4)} ${JSON.stringify(ls)}`);
      expect(sum).toBeLessThanOrEqual(w < 768 ? 0.08 : 0.05);
    });
  }
}
