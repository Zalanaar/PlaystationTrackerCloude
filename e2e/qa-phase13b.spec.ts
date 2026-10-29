// QA Фазы 13 (повторная приёмка, §18.9): 9 карточек на ширинах, блок «Скрытые», склонения, гонки скрытия/возврата.
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const mk = (id: number, name: string) => ({
  game: { id, name, imageUrl: null, bannerUrl: null, genres: ['ACTION', 'ADVENTURE'], hours: 22.5, hoursSource: 'hltb' },
  score: 4.7,
  signals: [
    { key: 'genre_affinity', label: 'Любимый жанр: 120 ч, 80% пройдено', contribution: 2.4 },
    { key: 'dropped_genre_penalty', label: 'Часто бросаешь этот жанр', contribution: -1 },
  ],
  reason: { text: `Тебе заходит экшен, и ${name} уйдёт около 22 часов.`, source: 'template' as const },
});
type S = {
  all: ReturnType<typeof mk>[]; hiddenIds: number[]; days: Record<number, number>; ttl: number; failList: boolean;
  getDelay: number[]; delOrder: number[]; gets: number; lists: number;
};
const LONG = 'СверхдлинноеназваниеигрыбезпробеловдлякорректнойпроверкипереносаСверхдлинноеназваниеигрыбезпробелов';
const names = (i: number) => (i === 1 ? LONG : `Игра ${i}`);
const state = (n = 12, o: Partial<S> = {}): S => ({
  all: Array.from({ length: n }, (_, i) => mk(i + 1, names(i + 1))), hiddenIds: [], days: {}, ttl: 30, failList: false, getDelay: [], delOrder: [], gets: 0, lists: 0, ...o,
});

async function open(page: Page, context: BrowserContext, baseURL: string, s: S) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, []);
  const ok = (r: Route, data: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  await page.route(/\/api\/recommend(\?.*)?$/, async (r) => {
    s.gets += 1;
    const d = s.getDelay.shift() ?? 0;
    const items = s.all.filter((i) => !s.hiddenIds.includes(i.game.id)).slice(0, 9); // снимок до задержки: имитирует медленный старый ответ
    if (d) await new Promise((x) => setTimeout(x, d));
    return ok(r, { items, meta: { llm: 'disabled', candidates: s.all.length - s.hiddenIds.length, time: 'any' } });
  });
  await page.route(/\/api\/recommend\/dislikes$/, (r) => {
    s.lists += 1;
    if (s.failList) return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'db_unavailable', message: 'x' } }) });
    const items = s.hiddenIds.map((id) => s.all.find((i) => i.game.id === id)!).map((i) => ({
      game: { id: i.game.id, name: i.game.name, imageUrl: null, bannerUrl: null, genres: i.game.genres },
      hiddenAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + (s.days[i.game.id] ?? s.ttl) * 86_400_000 - 3_600_000).toISOString(),
    }));
    return ok(r, { items, ttlDays: s.ttl });
  });
  await page.route('**/api/recommend/dislike', (r) => {
    const id = (r.request().postDataJSON() as { gameId: number }).gameId;
    if (!s.hiddenIds.includes(id)) s.hiddenIds.push(id);
    return ok(r, { gameId: id });
  });
  await page.route(/\/api\/recommend\/dislike\/\d+$/, (r) => {
    const id = Number(r.request().url().match(/dislike\/(\d+)/)?.[1]);
    s.delOrder.push(id);
    s.hiddenIds = s.hiddenIds.filter((x) => x !== id);
    return ok(r, { gameId: id });
  });
  await page.route('**/api/collection/summary', (r) =>
    ok(r, { totals: { games: 10, playSeconds: 0, hours: 0, trophiesEarned: 0, platinumEarned: 0 }, counts: { all: 10, playing: 0, completed: 0, dropped: 0, backlog: s.all.length, shelved: 0, service: 0, none: 0 }, playing: [], services: [], continue: [], profile: null, nearPlatinum: [] }));
  await page.goto('/recommend');
}
const cards = (p: Page) => p.locator('ol.ps-rec-list > li');
const noH = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('QA 13b: 9 карточек на ширинах', () => {
  for (const [w, h] of [[1280, 900], [1024, 800], [768, 900], [360, 740], [320, 640]] as const) {
    test(`${w}px: 9 карточек, длинное название, раскрыты все «Почему», блок «Скрытые» открыт`, async ({ page, context, baseURL, isMobile }) => {
      test.skip(isMobile, 'размер задаётся вручную');
      await page.setViewportSize({ width: w, height: h });
      const s = state(12, { hiddenIds: [10, 11], days: { 10: 1, 11: 30 } });
      s.all[9].game.name = LONG + LONG;
      await open(page, context, baseURL as string, s);
      await expect(cards(page)).toHaveCount(9);
      for (const b of await page.getByRole('button', { name: /Почему эта игра/ }).all()) await b.click();
      await page.getByRole('button', { name: /Скрытые на сейчас · 2/ }).click();
      await expect(page.locator('.ps-rec-hid__row')).toHaveCount(2);
      expect(await noH(page)).toBe(true);
      const cols = new Set(await cards(page).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)))).size;
      expect(cols).toBe(w >= 1024 ? 3 : 1);
      // кнопки строки «Вернуть» внутри окна
      const out = await page.locator('.ps-rec-hid__row button').evaluateAll((els, vw) => els.filter((e) => e.getBoundingClientRect().right > vw + 0.5).length, w);
      expect(out).toBe(0);
    });
  }
  test('мобильный профиль: 9 карточек без горизонтального скролла, «Вернуть» не ниже 44px', async ({ page, context, baseURL, isMobile }) => {
    test.skip(!isMobile, 'только мобильный профиль');
    await open(page, context, baseURL as string, state(12, { hiddenIds: [3] }));
    await expect(cards(page)).toHaveCount(9);
    await page.getByRole('button', { name: /Скрытые на сейчас · 1/ }).click();
    expect(await noH(page)).toBe(true);
    const box = await page.getByRole('button', { name: /Вернуть: / }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(43.5);
    const t = await page.getByRole('button', { name: /Скрытые на сейчас/ }).boundingBox();
    expect(t!.height).toBeGreaterThanOrEqual(43.5);
  });
});

test.describe('QA 13b: блок «Скрытые»', () => {
  test('склонения и «вернётся через N дн.» для 1, 2, 5, 11, 21, 30 суток; закрыт по умолчанию', async ({ page, context, baseURL }) => {
    const s = state(12, { hiddenIds: [2, 3, 4, 5, 6, 7], days: { 2: 1, 3: 2, 4: 5, 5: 11, 6: 21, 7: 30 } });
    await open(page, context, baseURL as string, s);
    const toggle = page.getByRole('button', { name: /Скрытые на сейчас · 6/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.ps-rec-hid__row').first()).toBeHidden();
    await toggle.click();
    for (const [id, d] of [[2, 1], [3, 2], [4, 5], [5, 11], [6, 21], [7, 30]] as const) {
      await expect(page.locator('.ps-rec-hid__row').filter({ hasText: `Игра ${id}` }).getByText(`вернётся через ${d} дн.`)).toBeVisible();
    }
  });
  for (const [ttl, word] of [[1, '1 день'], [2, '2 дня'], [5, '5 дней'], [11, '11 дней'], [21, '21 день'], [30, '30 дней']] as const) {
    test(`подпись «Скрыто на ${word}» при ttlDays=${ttl}`, async ({ page, context, baseURL }) => {
      await open(page, context, baseURL as string, state(12, { hiddenIds: [2], ttl }));
      await expect(page.getByRole('button', { name: /Скрытые на сейчас · 1/ })).toContainText(`Скрыто на ${word}`);
    });
  }
  test('все скрыты: «Показать скрытые» открывает блок и переносит фокус на заголовок блока; «Вернуть» возвращает карточки', async ({ page, context, baseURL }) => {
    const s = state(2, { hiddenIds: [1, 2] });
    await open(page, context, baseURL as string, s);
    await expect(page.getByText('Подсказывать нечего: все игры бэклога скрыты')).toBeVisible();
    await expect(page.getByText(/через 30 дней/)).toBeVisible();
    await page.getByRole('button', { name: /Показать скрытые: 2/ }).click();
    const toggle = page.getByRole('button', { name: /Скрытые на сейчас · 2/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toBeFocused();
    await page.getByRole('button', { name: 'Вернуть: Игра 2' }).click();
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Скрытые на сейчас · 1/ })).toBeVisible();
    await page.getByRole('button', { name: /Вернуть: / }).click();
    await expect(cards(page)).toHaveCount(2);
    await expect(page.getByRole('button', { name: /Скрытые на сейчас/ })).toHaveCount(0);
  });
  test('все скрыты, но список скрытых недоступен (503): есть путь вернуть или хотя бы повтор', async ({ page, context, baseURL }) => {
    const s = state(2, { hiddenIds: [1, 2], failList: true });
    await open(page, context, baseURL as string, s);
    await expect(page.getByText(/Подсказывать нечего|Подсказать пока нечего/)).toBeVisible();
    // фиксируем фактическое поведение: после ошибки списка кнопки возврата нет (см. BUG-R1 в docs/qa/phase-13.md)
    const hasWay = await page.getByRole('button', { name: /Показать скрытые|Повторить|Вернуть/ }).count();
    test.info().annotations.push({ type: 'BUG-R1', description: `способов вернуть при failList: ${hasWay}` });
    expect(hasWay).toBeGreaterThan(0);
  });
  test('ошибка списка при обычной выдаче: 9 карточек, блока нет, без баннера ошибки', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, state(12, { failList: true }));
    await expect(cards(page)).toHaveCount(9);
    await expect(page.getByRole('button', { name: /Скрытые на сейчас/ })).toHaveCount(0);
    await expect(page.locator('.ps-rec-banner, .ps-rec-panel[role=alert]')).toHaveCount(0);
  });
});

test.describe('QA 13b: гонки', () => {
  test('5 быстрых «Не интересно» подряд: все скрыты, 4 карточки остаются, блок «· 5», итог не зависит от порядка ответов', async ({ page, context, baseURL }) => {
    const s = state(9, { getDelay: [700, 50, 400, 10, 300, 0] });
    await open(page, context, baseURL as string, s);
    await expect(cards(page)).toHaveCount(9);
    for (const n of [2, 3, 4, 5, 6]) {
      await page.getByRole('button', { name: `Не интересно: Игра ${n}` }).click({ noWaitAfter: true });
    }
    await expect(page.getByRole('button', { name: /Скрытые на сейчас · 5/ })).toBeVisible({ timeout: 8000 });
    await expect(cards(page)).toHaveCount(4);
    await expect(page.locator('.ps-rec-list [aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByText('Подбираю…')).toHaveCount(0);
    for (const n of [2, 3, 4, 5, 6]) await expect(page.getByRole('button', { name: `Не интересно: Игра ${n}` })).toHaveCount(0);
    expect(await noH(page)).toBe(true);
  });
  test('«Вернуть» во время медленного перезапроса: итог = актуальное состояние сервера', async ({ page, context, baseURL }) => {
    const s = state(9, { hiddenIds: [8, 9], getDelay: [0, 1200, 0, 0] });
    await open(page, context, baseURL as string, s);
    await expect(cards(page)).toHaveCount(7);
    await page.getByRole('button', { name: /Скрытые на сейчас · 2/ }).click();
    await page.getByRole('button', { name: 'Не интересно: Игра 2' }).click(); // GET #2 медленный, снимок без Игры 2, но с 8 и 9 скрытыми
    await page.getByRole('button', { name: 'Вернуть: Игра 8' }).click({ timeout: 5000 }); // во время ожидания
    await expect(cards(page)).toHaveCount(7, { timeout: 8000 }); // 9 - (2) = 8 видимых с 8-й... = 1,3..8,9? скрыты 2 и 9
    await expect(page.getByRole('button', { name: 'Не интересно: Игра 8' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Не интересно: Игра 2' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Скрытые на сейчас · 2/ })).toBeVisible();
    await page.waitForTimeout(1500); // дожидаемся устаревшего ответа: он не должен перезаписать экран
    await expect(page.getByRole('button', { name: 'Не интересно: Игра 8' })).toBeVisible();
    expect(s.hiddenIds.sort()).toEqual([2, 9]);
  });
  test('двойной клик «Вернуть» не шлёт два DELETE (кнопка блокируется)', async ({ page, context, baseURL }) => {
    const s = state(9, { hiddenIds: [4] });
    await open(page, context, baseURL as string, s);
    await page.getByRole('button', { name: /Скрытые на сейчас · 1/ }).click();
    await page.getByRole('button', { name: 'Вернуть: Игра 4' }).dblclick();
    await expect(cards(page)).toHaveCount(9);
    expect(s.delOrder).toEqual([4]);
  });
});

test.describe('QA 13b: регрессии вкладок', () => {
  test('шапка/tab bar: 6 пунктов, «Подскажи» активна, переходы на другие вкладки и обратно', async ({ page, context, baseURL, isMobile }) => {
    await open(page, context, baseURL as string, state(12));
    await expect(cards(page)).toHaveCount(9);
    const nav = isMobile ? page.locator('nav').last() : page.locator('header nav').first();
    await expect(nav.getByRole('link')).toHaveCount(6);
    await nav.getByRole('link', { name: /Бэклог/ }).click();
    await expect(page).toHaveURL(/\/backlog/);
    await page.goBack();
    await expect(page).toHaveURL(/\/recommend/);
    await expect(cards(page)).toHaveCount(9);
  });
});
