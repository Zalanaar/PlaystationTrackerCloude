// Фаза 40 (QA): «Уже есть / проходил» в «У тебя нет». API эмулируется по контракту «Фаза 40» (фильтр отметок на чтении, как на сервере).
// Запуск: PW_CHROMIUM_PATH=/usr/bin/google-chrome QA_PORT=3340 npx playwright test -c e2e/qa.config.ts e2e/phase40-owned.spec.ts
// Снимки (7 тем, 360 px): SHOTS_DIR=docs/qa/shots-40 ... --project=desktop
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { mockApi, seed, type G, type Mock } from './collection-mock';
import { signedSession } from './session';

const item = (id: number, title: string) => ({
  externalSource: 'rawg', externalId: String(id), title, releaseDate: '2019-05-05', coverUrl: null, platforms: ['PS5', 'PS4'], genres: ['ACTION'],
  rating: 4.3, metacritic: 91, rawgUrl: `https://rawg.io/games/g${id}`, reason: { text: `Причина (${title})`, source: 'template' }, planned: false, plannedId: null,
});
type Mark = { externalId: string; title: string; coverUrl: string | null; kind: 'covered' | 'not_in_library'; completed: boolean; gameId: number | null; t: number };
type S = {
  all: ReturnType<typeof item>[]; marks: Map<string, Mark>; clock: number; puts: unknown[]; deletes: string[]; discoverGets: number;
  failPut: boolean; failDelete: boolean; lib: G[]; delayGet: number;
};
const libGames = (n: number): G[] => Array.from({ length: n }, (_, i) => ({
  id: 1000 + i, title: `Игра ${String(i + 1).padStart(3, '0')}`, lastPlayedAt: null, status: null, completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null,
}));
const mk = (o: Partial<S> = {}): S => ({
  all: [item(1, 'Uncharted 2'), item(2, 'Uncharted 3'), item(3, 'Uncharted 4'), item(4, 'Bloodborne')], marks: new Map(), clock: 0, puts: [], deletes: [], discoverGets: 0,
  failPut: false, failDelete: false, lib: [], delayGet: 0, ...o,
});
const tourStub = JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } });

async function open(page: Page, context: BrowserContext, baseURL: string, s: S = mk()): Promise<{ s: S; m: Mock }> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const m = await mockApi(page, s.lib.length ? s.lib : [...seed(), { id: 50, title: 'Nathan Drake Collection', lastPlayedAt: null, status: null, completedAt: null, droppedAt: null, playSeconds: 0, playCount: 0, trophies: null }]);
  const ok = (r: Route, data: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  const fail = (r: Route, status: number, code: string) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code, message: 'x' } }) });
  const gameOf = (id: number | null) => m.games.find((g) => g.id === id);
  const view = (x: Mark) => ({
    externalSource: 'rawg', externalId: x.externalId, title: x.title, coverUrl: x.coverUrl, kind: x.kind, completed: x.completed,
    coveredBy: x.gameId === null ? null : { gameId: x.gameId, name: gameOf(x.gameId)?.title ?? '', imageUrl: null },
    createdAt: new Date(x.t).toISOString(), updatedAt: new Date(x.t).toISOString(),
  });
  await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: tourStub }));
  await page.route(/\/api\/recommend$/, (r) => ok(r, { items: [], meta: { llm: 'disabled', candidates: 0, time: 'any', llmPending: 0 } }));
  await page.route(/\/api\/recommend\/dislikes$/, (r) => ok(r, { items: [], ttlDays: 30 }));
  await page.route(/\/api\/recommend\/discover$/, async (r) => {
    s.discoverGets += 1;
    if (s.delayGet && s.discoverGets > 1) await new Promise((res) => setTimeout(res, s.delayGet));
    const items = s.all.filter((i) => !s.marks.has(i.externalId));
    return ok(r, { items, meta: { catalog: 'ok', generatedAt: '2026-10-31T05:00:00.000Z', stale: false, partial: false, reason: items.length ? null : 'no_candidates', total: s.all.length, limit: 12 } });
  });
  await page.route(/\/api\/owned-marks(\?.*)?$/, (r) => {
    if (r.request().method() === 'PUT') {
      const b = r.request().postDataJSON() as { externalId: string; title: string; coverUrl: string | null; kind: 'covered' | 'not_in_library'; coveredByGameId?: number; completed?: boolean };
      s.puts.push(b);
      if (s.failPut) return fail(r, 503, 'db_unavailable');
      s.marks.set(b.externalId, { externalId: b.externalId, title: b.title, coverUrl: b.coverUrl, kind: b.kind, completed: b.completed ?? false, gameId: b.coveredByGameId ?? null, t: Date.UTC(2026, 10, 1, 9, 0, ++s.clock) });
      return ok(r, { mark: view(s.marks.get(b.externalId) as Mark) });
    }
    return ok(r, { marks: [...s.marks.values()].sort((a, b) => b.t - a.t).map(view) });
  });
  await page.route(/\/api\/owned-marks\/recent-collections/, (r) => {
    const by = new Map<number, { n: number; t: number }>();
    for (const x of s.marks.values()) if (x.gameId !== null) { const c = by.get(x.gameId) ?? { n: 0, t: 0 }; by.set(x.gameId, { n: c.n + 1, t: Math.max(c.t, x.t) }); }
    return ok(r, { collections: [...by.entries()].sort((a, b) => b[1].t - a[1].t).map(([id, c]) => ({ gameId: id, name: gameOf(id)?.title ?? '', imageUrl: null, coveredCount: c.n, lastUsedAt: new Date(c.t).toISOString() })) });
  });
  await page.route(/\/api\/owned-marks\/[^/?]+$/, (r) => {
    const id = decodeURIComponent(r.request().url().split('/').pop() as string);
    s.deletes.push(id);
    if (s.failDelete) return fail(r, 503, 'db_unavailable');
    const removed = s.marks.delete(id);
    return ok(r, { externalId: id, removed });
  });
  await page.route('**/api/roadmap/planned', (r) => ok(r, { planned: [] }));
  await page.route('**/api/collection/summary', (r) =>
    ok(r, { totals: { games: 10, playSeconds: 0, hours: 0, trophiesEarned: 0, platinumEarned: 0 }, counts: { all: 10, playing: 0, completed: 0, dropped: 0, backlog: 3, shelved: 0, service: 0, none: 0 }, playing: [], services: [], continue: [], profile: null, nearPlatinum: [] }));
  await page.goto('/recommend?tab=discover');
  await page.getByTestId('discover-card').first().waitFor();
  return { s, m };
}

const card = (page: Page, t: string) => page.getByRole('listitem', { name: new RegExp(t) });
const ownBtn = (page: Page, t: string) => card(page, t).getByRole('button', { name: /Уже есть или проходил/ });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Уже есть у тебя' });
const pick = (page: Page, name: string) => dialog(page).getByRole('radio', { name, exact: true });
const noH = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('«Уже есть»', () => {
  test('covered: выбор сборника, PUT без completed, карточка уходит, фокус на соседней, «Отменить» возвращает', async ({ page, context, baseURL }) => {
    const { s } = await open(page, context, baseURL as string);
    await ownBtn(page, 'Uncharted 3').click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('radiogroup', { name: 'Как отметить игру' })).toBeVisible();
    const save = dialog(page).getByRole('button', { name: 'Сохранить' });
    await expect(save).toBeDisabled();
    await dialog(page).getByRole('searchbox', { name: 'Поиск по библиотеке' }).fill('nathan');
    await pick(page, 'Nathan Drake Collection').click();
    await expect(pick(page, 'Nathan Drake Collection')).toHaveAttribute('aria-checked', 'true');
    await save.click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByTestId('discover-card')).toHaveCount(3);
    expect(s.puts).toEqual([{ externalSource: 'rawg', externalId: '2', title: 'Uncharted 3', coverUrl: null, kind: 'covered', coveredByGameId: 50 }]);
    await expect(page.getByText('Убрано из подборки: «Uncharted 3»')).toBeVisible();
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-ext'))).toBe('3');
    await expect(page.getByRole('button', { name: /^Отмеченные/ })).toContainText('1');
    const before = s.discoverGets;
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByTestId('discover-card')).toHaveCount(4);
    expect(s.deletes).toEqual(['2']);
    expect(s.discoverGets).toBeGreaterThan(before);
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-ext'))).toBe('2');
    await expect(card(page, 'Uncharted 3')).toBeVisible();
  });

  test('not_in_library + «прошёл»: тело без coveredByGameId; без галки completed=false', async ({ page, context, baseURL }) => {
    const { s } = await open(page, context, baseURL as string);
    await ownBtn(page, 'Bloodborne').click();
    await pick(page, 'Нет в библиотеке').click();
    await expect(dialog(page).getByRole('button', { name: 'Сохранить' })).toBeEnabled();
    await dialog(page).getByLabel('Прошёл эту игру').check();
    await dialog(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByTestId('discover-card')).toHaveCount(3);
    await ownBtn(page, 'Uncharted 2').click();
    await pick(page, 'Нет в библиотеке').click();
    await dialog(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByTestId('discover-card')).toHaveCount(2);
    expect(s.puts[0]).toEqual({ externalSource: 'rawg', externalId: '4', title: 'Bloodborne', coverUrl: null, kind: 'not_in_library', completed: true });
    expect(s.puts[1]).toMatchObject({ kind: 'not_in_library', completed: false });
    expect(Object.keys(s.puts[1] as object)).not.toContain('coveredByGameId');
  });

  test('1 -> много: тот же сборник у двух игр, «Недавно выбранные» наверху списка', async ({ page, context, baseURL }) => {
    const { s } = await open(page, context, baseURL as string);
    for (const t of ['Uncharted 2', 'Uncharted 3']) {
      await ownBtn(page, t).click();
      await dialog(page).getByRole('searchbox').fill('nathan');
      await pick(page, 'Nathan Drake Collection').click();
      await dialog(page).getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog(page)).toHaveCount(0);
    }
    expect((s.puts as { coveredByGameId: number }[]).map((p) => p.coveredByGameId)).toEqual([50, 50]);
    await ownBtn(page, 'Uncharted 4').click();
    await expect(dialog(page).getByRole('heading', { name: 'Недавно выбранные' })).toBeVisible();
    const first = dialog(page).getByTestId('owned-row').first();
    await expect(first).toContainText('Nathan Drake Collection');
    // одним тапом + сохранить
    await first.click();
    await dialog(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByTestId('discover-card')).toHaveCount(1);
    expect(s.puts).toHaveLength(3);
    // в общем списке «Библиотека» сборник не дублируется
    await ownBtn(page, 'Bloodborne').click();
    await expect(dialog(page).getByTestId('owned-row').filter({ hasText: 'Nathan Drake Collection' })).toHaveCount(1);
  });

  test('a11y листа: Esc закрывает и возвращает фокус на кнопку, стрелки в радиогруппе, aria-live', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    const btn = ownBtn(page, 'Uncharted 2');
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    const modes = dialog(page).getByRole('radiogroup', { name: 'Как отметить игру' }).getByRole('radio');
    await expect(modes).toHaveCount(2);
    await modes.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(modes.nth(1)).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(modes.first()).toHaveAttribute('aria-checked', 'true');
    await dialog(page).getByRole('searchbox').fill('god');
    await expect(dialog(page).locator('[aria-live="polite"]')).toHaveText('Найдено 1 игра');
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(btn).toBeFocused();
    // нет отметки при Esc
    await expect(page.getByTestId('discover-card')).toHaveCount(4);
  });

  test('ошибка сохранения: лист остаётся, баннер, карточка на месте; ошибка отмены даёт тост', async ({ page, context, baseURL }) => {
    const { s } = await open(page, context, baseURL as string);
    s.failPut = true;
    await ownBtn(page, 'Uncharted 2').click();
    await pick(page, 'Нет в библиотеке').click();
    await dialog(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog(page).getByRole('alert')).toContainText('Не удалось сохранить');
    await expect(page.getByTestId('discover-card')).toHaveCount(4);
    s.failPut = false;
    await dialog(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByTestId('discover-card')).toHaveCount(3);
    s.failDelete = true;
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByText(/Не удалось вернуть/)).toBeVisible();
    await expect(page.getByTestId('discover-card')).toHaveCount(3);
  });

  test('«Отмеченные»: список, подпись, «Вернуть в подборку» сразу возвращает карточку; фильтры только при >5', async ({ page, context, baseURL }) => {
    const s = mk({ all: Array.from({ length: 8 }, (_, i) => item(i + 1, `Игра ${i + 1}`)) });
    await open(page, context, baseURL as string, s);
    for (let i = 1; i <= 6; i++) {
      await ownBtn(page, `Игра ${i}$`).click();
      await pick(page, 'Нет в библиотеке').click();
      if (i % 2 === 0) await dialog(page).getByLabel('Прошёл эту игру').check();
      await dialog(page).getByRole('button', { name: 'Сохранить' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(page.getByTestId('discover-card')).toHaveCount(8 - i);
    }
    await page.getByRole('button', { name: /^Отмеченные/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Отмеченные игры' });
    await expect(sheet.getByTestId('owned-item')).toHaveCount(6);
    await expect(sheet.getByRole('radiogroup', { name: 'Фильтр отмеченных' })).toBeVisible();
    await sheet.getByRole('radio', { name: /^Прошёл/ }).click();
    await expect(sheet.getByTestId('owned-item')).toHaveCount(3);
    await expect(sheet.getByTestId('owned-item').first()).toContainText('Нет в библиотеке · Прошёл');
    await sheet.getByRole('button', { name: /Вернуть в подборку: «Игра 6»/ }).click();
    await expect(sheet.getByTestId('owned-item')).toHaveCount(2);
    expect(s.deletes).toEqual(['6']);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('discover-card')).toHaveCount(3);
    await expect(card(page, 'Игра 6$')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Отмеченные/ })).toContainText('5');
  });

  // QA-40-1: отложенный load после «Сохранить» переносит фокус на карточку под открытым листом «Отмеченные»; Esc перестаёт работать.
  // test.fail: тест зелёный, пока баг есть; после исправления станет красным, тогда убрать test.fail.
  test.fail('QA-40-1: фокус не уходит из открытого листа «Отмеченные» после отложенной перезагрузки подборки', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, mk({ delayGet: 1200 }));
    await ownBtn(page, 'Uncharted 2').click();
    await pick(page, 'Нет в библиотеке').click();
    await dialog(page).getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await page.getByRole('button', { name: /^Отмеченные/ }).click();
    const marks = page.getByRole('dialog', { name: 'Отмеченные игры' });
    await expect(marks).toBeVisible();
    await page.waitForTimeout(2000);
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(marks).toHaveCount(0);
  });

  test('пустые «Отмеченные»: заглушка', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await page.getByRole('button', { name: /^Отмеченные/ }).click();
    await expect(page.getByRole('heading', { name: 'Пока ничего не отмечено' })).toBeVisible();
  });

  test('библиотека >300 игр: страницы по 300 подгружаются, поиск находит игру из хвоста (риск 7)', async ({ page, context, baseURL }) => {
    const { m } = await open(page, context, baseURL as string, mk({ lib: libGames(650) }));
    await ownBtn(page, 'Uncharted 2').click();
    await dialog(page).getByRole('searchbox').fill('Игра 649');
    await expect(dialog(page).getByTestId('owned-row')).toHaveCount(1);
    const calls = m.listCalls.filter((u) => u.searchParams.get('sort') === 'title').map((u) => `${u.searchParams.get('limit')}/${u.searchParams.get('offset')}`);
    expect([...new Set(calls)]).toEqual(['300/0', '300/300', '300/600']); // dev StrictMode может продублировать первый запрос
    // без поиска рендерится 50 строк + «Показать ещё»
    await dialog(page).getByRole('button', { name: 'Очистить поиск' }).click();
    await expect(dialog(page).getByTestId('owned-row')).toHaveCount(50);
    await expect(dialog(page).getByRole('button', { name: 'Показать ещё' })).toBeVisible();
  });

  test('360 px: нет горизонтального скролла, кнопки не обрезаны, лист в пределах экрана', async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await open(page, context, baseURL as string);
    expect(await noH(page)).toBeLessThanOrEqual(0);
    await ownBtn(page, 'Uncharted 2').click();
    expect(await noH(page)).toBeLessThanOrEqual(0);
    const box = await dialog(page).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 360 && box.y >= 0).toBe(true);
    for (const b of await dialog(page).getByRole('button').all()) {
      const bb = await b.boundingBox();
      if (bb) expect(bb.x + bb.width).toBeLessThanOrEqual(360.5);
    }
  });
});

const SHOTS = process.env.SHOTS_DIR;
const THEMES = ['night', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5', 'graphite'] as const;
const setTheme = (page: Page, v: string) => page.evaluate((t) => { if (t === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }, v);
test.describe('снимки', () => {
  test.skip(!SHOTS, 'нужен SHOTS_DIR');
  for (const theme of THEMES) {
    test(`shots ${theme}`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      const s = mk({ all: Array.from({ length: 7 }, (_, i) => item(i + 1, i === 0 ? 'Uncharted: The Nathan Drake Collection very long title to wrap' : `Игра ${i + 1}`)) });
      await open(page, context, baseURL as string, s);
      await setTheme(page, theme);
      await ownBtn(page, 'Uncharted').click();
      await dialog(page).getByTestId('owned-row').nth(2).click();
      await page.screenshot({ path: `${SHOTS}/own-pick-360-${theme}.png` });
      await pick(page, 'Нет в библиотеке').click();
      await dialog(page).getByLabel('Прошёл эту игру').check();
      await page.screenshot({ path: `${SHOTS}/own-none-360-${theme}.png` });
      await dialog(page).getByRole('button', { name: 'Сохранить' }).click();
      await expect(page.getByText(/Убрано из подборки/)).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/own-toast-360-${theme}.png` });
      for (let i = 2; i <= 6; i++) {
        await ownBtn(page, `Игра ${i}$`).click();
        await pick(page, 'Нет в библиотеке').click();
        await dialog(page).getByRole('button', { name: 'Сохранить' }).click();
        await expect(dialog(page)).toHaveCount(0);
      }
      await page.waitForTimeout(800); // дать отработать отложенной перезагрузке подборки (см. QA-40-1)
      await page.getByRole('button', { name: /^Отмеченные/ }).click();
      await expect(page.getByTestId('owned-item').first()).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/own-marks-360-${theme}.png` });
      expect(await noH(page)).toBeLessThanOrEqual(0);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.setViewportSize({ width: 1280, height: 800 });
      await ownBtn(page, 'Игра 7').click();
      await page.screenshot({ path: `${SHOTS}/own-pick-desktop-${theme}.png` });
    });
  }
});
