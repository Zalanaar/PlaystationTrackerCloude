// t272u–t274u: «Предстоящие релизы» в потоке страницы (без внутреннего скролла), все страницы каталога
// достижимы, список по дате; кнопка «Наверх» не закрывает карандаш/корзину в блоке «Релизы».
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { baseState, mockRoadmap, upc, type RmPlanned } from './roadmap-mock';
import { signedSession } from './session';

const rel = (id: number, title: string, date: string, o: Partial<RmPlanned> = {}): RmPlanned => ({
  id, title, releaseDate: date, coverUrl: null, wantAtRelease: true, hoursManual: 10, externalSource: 'rawg', externalId: String(id), status: 'planned', ...o,
});

async function open(page: Page, context: BrowserContext, baseURL: string) {
  const page1 = [
    upc(1, { title: 'FF7 Revelation', releaseDate: '2027-04-08' }),
    upc(2, { title: 'God of War Laufey', releaseDate: '2027-05-20' }),
    upc(3, { title: 'Titan Quest 2', releaseDate: '2027-01-12' }),
    upc(4, { title: 'Until Dawn 2', releaseDate: '2027-01-28' }),
    upc(5, { title: 'No Rest for the Wicked', releaseDate: '2027-03-04' }),
    upc(6, { title: 'Lords of the Fallen 2', releaseDate: '2027-03-31' }),
    upc(7, { title: 'Exodus', releaseDate: '2027-04-07' }),
    upc(8, { title: 'Metro 2039', releaseDate: '2027-02-04' }),
  ];
  const page2 = [
    upc(9, { title: 'Clutch', releaseDate: '2027-05-31' }),
    upc(10, { title: 'Daba', releaseDate: '2027-05-31' }),
    upc(11, { title: 'Cronos Lazarus', releaseDate: '2028-12-03' }), // клиент покажет (фильтр окна — на сервере); порядок среди страницы 2 всё равно по дате
    upc(12, { title: 'ananta', releaseDate: '2027-01-15' }),
  ];
  const planned = [1, 2, 3, 4, 5].map((i) => rel(20 + i, `Релиз ${i}`, `2027-0${i}-15`));
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, []);
  const s = await mockRoadmap(page, baseState({
    year: 2027, today: '2026-11-24',
    planned,
    upcoming: { pages: [page1, page2], fail: null },
  }));
  await page.goto('/roadmap');
  await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
  return s;
}

test.describe('Предстоящие релизы: страницы, порядок, поток', () => {
  test('список не во вложенном скролле, по дате, «Показать ещё» открывает вторую страницу', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    const list = page.getByTestId('rm-upcoming');
    await expect(list.getByTestId('rm-upcoming-row').first()).toBeVisible();
    await expect.poll(() => s.calls.upcoming[0]).toBe(1);
    await expect(page.getByTestId('rm-upcoming-total')).toContainText(/В каталоге 12/);

    const box = await list.evaluate((el) => {
      const s = getComputedStyle(el);
      return { overflowY: s.overflowY, maxHeight: s.maxHeight, scroll: el.scrollHeight, client: el.clientHeight };
    });
    // без фиксированной высоты блок растёт вместе с содержимым — крутится страница, не внутренний контейнер
    expect(box.maxHeight).toBe('none');
    expect(box.scroll).toBeLessThanOrEqual(box.client + 1);

    await expect.poll(() => page.getByTestId('rm-upcoming-row').count()).toBeGreaterThanOrEqual(8);
    const first8 = (await page.getByTestId('rm-upcoming-row').locator('b').allTextContents()).slice(0, 8);
    expect(first8).toEqual([
      'Titan Quest 2', 'Until Dawn 2', 'Metro 2039', 'No Rest for the Wicked',
      'Lords of the Fallen 2', 'Exodus', 'FF7 Revelation', 'God of War Laufey',
    ]);
    // нативный click: Playwright actionability ловит detach, когда IO догружает страницу и кнопку перерисовывают
    await page.evaluate(() => {
      const btn = document.querySelector('.ps-rm-upc__more button') as HTMLButtonElement | null;
      btn?.scrollIntoView({ block: 'nearest' });
      if (btn && !btn.disabled) btn.click();
    });
    await expect.poll(() => page.getByTestId('rm-upcoming-row').count()).toBe(12);
    expect(s.calls.upcoming).toEqual([1, 2]);
    expect(await page.getByTestId('rm-upcoming-row').locator('b').allTextContents()).toEqual([
      'Titan Quest 2', 'ananta', 'Until Dawn 2', 'Metro 2039', 'No Rest for the Wicked',
      'Lords of the Fallen 2', 'Exodus', 'FF7 Revelation', 'God of War Laufey', 'Clutch', 'Daba',
      'Cronos Lazarus',
    ]);
    await expect(page.getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);
    const box2 = await list.evaluate((el) => ({ maxHeight: getComputedStyle(el).maxHeight, scroll: el.scrollHeight, client: el.clientHeight }));
    expect(box2.maxHeight).toBe('none');
    expect(box2.scroll).toBeLessThanOrEqual(box2.client + 1);
  });
});

test.describe('Релизы: кнопка «Наверх» не закрывает действия', () => {
  test.beforeEach(({ isMobile }) => test.skip(!isMobile, 'FAB только на телефоне'));

  test('карандаш и корзина последней карточки не пересекаются с «Наверх»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const last = page.getByRole('button', { name: 'Удалить: Релиз 5' });
    await last.scrollIntoViewIfNeeded();
    // не уезжаем в конец страницы (ниже ещё «Предстоящие релизы») — карточка должна остаться в кадре
    const totop = page.getByRole('button', { name: 'Наверх' });
    await expect(totop).toBeVisible();
    const hit = await page.evaluate(() => {
      const trash = document.querySelector('button[aria-label="Удалить: Релиз 5"]');
      const pencil = document.querySelector('button[aria-label="Изменить: Релиз 5"]');
      const fab = document.querySelector('.ps-totop');
      if (!trash || !pencil || !fab) return { ok: false, overlap: true };
      const overlap = (a: DOMRect, b: DOMRect) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
      const f = fab.getBoundingClientRect();
      return { ok: true, overlap: overlap(trash.getBoundingClientRect(), f) || overlap(pencil.getBoundingClientRect(), f) };
    });
    expect(hit.ok).toBe(true);
    expect(hit.overlap).toBe(false);
    const mid = await last.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const node = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!node?.closest('button[aria-label="Удалить: Релиз 5"]');
    });
    expect(mid).toBe(true);
  });
});
