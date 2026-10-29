// QA Фазы 13b: независимые проверки режима «Новое от ИИ»: инъекции в тексте, отмена запросов, refresh только по клику,
// гонки скрытия/возврата, тосты, раскладка 320-1280 с 9 карточками. API эмулируется по контракту §19.
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

type DItem = {
  externalSource: 'rawg'; externalId: string; title: string; releaseDate: string | null; coverUrl: string | null;
  platforms: string[]; reason: string; planned: boolean; plannedId: number | null;
};
const dItem = (id: string, title: string, o: Partial<DItem> = {}): DItem => ({
  externalSource: 'rawg', externalId: id, title, releaseDate: '2015-05-18', coverUrl: null, platforms: ['PlayStation 4', 'PlayStation 5'],
  reason: `Причина для ${title}.`, planned: false, plannedId: null, ...o,
});
const meta = (o: Record<string, unknown> = {}) => ({ llm: 'ok', catalog: 'ok', cached: true, generatedAt: '2026-10-29T10:00:00.000Z', refreshLeft: 3, verified: 11, proposed: 15, ...o });

type S = {
  all: DItem[]; hidden: string[]; refreshLeft: number; delayMs: number; hideDelay: Record<string, number>; unhideDelay: Record<string, number>; planFail: number;
  calls: { get: string[]; hide: string[]; unhide: string[]; plan: number };
  aborted: number;
};
const nine = (): DItem[] => Array.from({ length: 9 }, (_, i) => dItem(String(i + 1), `Игра номер ${i + 1}`));

async function open(page: Page, context: BrowserContext, baseURL: string, o: Partial<S> = {}, path = '/recommend?mode=discover'): Promise<S> {
  const s: S = { all: nine().slice(0, 3), hidden: [], refreshLeft: 3, delayMs: 0, hideDelay: {}, unhideDelay: {}, planFail: 0, calls: { get: [], hide: [], unhide: [], plan: 0 }, aborted: 0, ...o };
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, []);
  const ok = (r: Route, data: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  page.on('requestfailed', (req) => { if (/\/api\/recommend\/discover(\?.*)?$/.test(req.url())) s.aborted += 1; });
  await page.route(/\/api\/recommend(\?.*)?$/, (r) => ok(r, { items: [{
    game: { id: 1, name: 'Хейдес', imageUrl: null, bannerUrl: null, genres: ['ACTION'], hours: 22.5, hoursSource: 'hltb' }, score: 4.7, signals: [],
    reason: { text: 'Фраза бэклога.', source: 'template' },
  }], meta: { llm: 'disabled', candidates: 37, time: 'any' } }));
  await page.route(/\/api\/recommend\/dislikes$/, (r) => ok(r, { items: [], ttlDays: 30 }));
  await page.route(/\/api\/recommend\/discover(\?.*)?$/, async (r) => {
    const url = new URL(r.request().url());
    s.calls.get.push(url.search || 'plain');
    if (s.delayMs) await new Promise((x) => setTimeout(x, s.delayMs));
    const refresh = url.searchParams.get('refresh') === '1';
    if (refresh && s.refreshLeft > 0) s.refreshLeft -= 1;
    return ok(r, { items: s.all.filter((i) => !s.hidden.includes(i.externalId)), meta: meta({ refreshLeft: s.refreshLeft, cached: !refresh }) });
  });
  await page.route(/\/api\/recommend\/discover\/dislikes$/, (r) => ok(r, {
    items: s.all.filter((i) => s.hidden.includes(i.externalId)).map((i) => ({
      externalSource: 'rawg', externalId: i.externalId, title: i.title, coverUrl: i.coverUrl, hiddenAt: '2026-10-29T10:00:00.000Z',
      expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    })),
    ttlDays: 30,
  }));
  await page.route(/\/api\/recommend\/discover\/dislike$/, async (r) => {
    const b = r.request().postDataJSON() as { externalId: string };
    s.calls.hide.push(b.externalId);
    const d = s.hideDelay[b.externalId] ?? 0;
    if (d) await new Promise((x) => setTimeout(x, d));
    if (!s.hidden.includes(b.externalId)) s.hidden.push(b.externalId);
    return ok(r, { externalId: b.externalId });
  });
  await page.route(/\/api\/recommend\/discover\/dislike\/[^/]+$/, async (r) => {
    const id = decodeURIComponent(r.request().url().split('/').pop() as string);
    s.calls.unhide.push(id);
    const d = s.unhideDelay[id] ?? 0;
    if (d) await new Promise((x) => setTimeout(x, d));
    s.hidden = s.hidden.filter((x) => x !== id);
    return ok(r, { externalId: id });
  });
  await page.route(/\/api\/roadmap\/planned$/, (r) => {
    if (r.request().method() !== 'POST') return ok(r, { planned: [] });
    s.calls.plan += 1;
    if (s.planFail > 0) { s.planFail -= 1; return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'db_unavailable', message: 'x' } }) }); }
    return ok(r, { planned: { id: 7 } });
  });
  await page.goto(path);
  return s;
}

const cardsList = (page: Page) => page.getByRole('listitem', { name: /^Новая игра/ });
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const modes = (page: Page) => page.getByRole('radiogroup', { name: 'Режим подсказок' });

test.describe('QA 13b: текст из внешних источников рисуется как текст', () => {
  const evil = [
    dItem('1', '<img src=x onerror="window.__pwn=1">Evil', { reason: '<script>window.__pwn=1</script> **жирный** [ссылка](javascript:window.__pwn=1) &lt;b&gt;' }),
    dItem('2', 'Ш'.repeat(300), { reason: 'W'.repeat(200) }),
    dItem('3', 'x'.repeat(40) + ' ' + 'y'.repeat(150), { reason: 'a‮b\u0000c\nd', coverUrl: 'https://localhost.invalid/nope.jpg' }),
  ];
  for (const w of [1280, 320]) {
    test(`инъекции и длинные строки на ${w}: нет исполнения, нет скролла, обложка с ошибкой даёт букву`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await open(page, context, baseURL as string, { all: evil });
      await expect(cardsList(page)).toHaveCount(3);
      expect(await page.evaluate(() => (window as unknown as { __pwn?: number }).__pwn)).toBeUndefined();
      expect(await page.locator('ol.ps-rec-list img[src="x"], ol.ps-rec-list script, ol.ps-rec-list b').count()).toBe(0);
      await expect(page.getByText('<script>window.__pwn=1</script>', { exact: false })).toBeVisible();
      expect(await noHScroll(page)).toBe(true);
      // скрытый блок с теми же названиями
      await page.getByRole('button', { name: /^Не интересно:/ }).first().click();
      await page.getByRole('button', { name: /Скрытые на сейчас · 1/ }).click();
      expect(await noHScroll(page)).toBe(true);
      expect(await page.evaluate(() => (window as unknown as { __pwn?: number }).__pwn)).toBeUndefined();
      // img: без реферера
      const imgs = await page.locator('ol.ps-rec-list img').evaluateAll((l) => l.map((i) => (i as HTMLImageElement).referrerPolicy));
      for (const p of imgs) expect(p).toBe('no-referrer');
    });
  }
});

test.describe('QA 13b: режимы, URL, запросы', () => {
  test('на discover не уходит time; refresh=1 не шлётся при возврате/скрытии/смене режима; история не растёт', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, {}, '/recommend?mode=discover&time=short');
    await expect(cardsList(page)).toHaveCount(3);
    await expect(page).toHaveURL(/\/recommend\?mode=discover$/);
    const h0 = await page.evaluate(() => history.length);
    await modes(page).getByRole('radio', { name: 'Из бэклога' }).click();
    await expect(page).toHaveURL(/\/recommend$/);
    await modes(page).getByRole('radio', { name: 'Новое от ИИ' }).click();
    await expect(cardsList(page)).toHaveCount(3);
    await page.getByRole('button', { name: 'Не интересно: Игра номер 1' }).click();
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(cardsList(page)).toHaveCount(3);
    expect(await page.evaluate(() => history.length)).toBe(h0);
    await expect.poll(() => s.calls.unhide.length).toBe(1);
    expect(s.calls.get.length).toBeGreaterThanOrEqual(3);
    for (const c of s.calls.get) { expect(c).toBe('plain'); }
  });

  test('двойной клик «Обновить подборку»: один refresh=1', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, { delayMs: 300 });
    await expect(cardsList(page)).toHaveCount(3);
    const btn = page.getByRole('button', { name: /^Обновить подборку/ });
    await btn.dblclick();
    await expect(page.getByRole('button', { name: /^Обновить подборку/ })).toBeEnabled();
    expect(s.calls.get.filter((c) => c.includes('refresh=1'))).toHaveLength(1);
    expect(s.refreshLeft).toBe(2);
  });

  test('смена режима во время долгой загрузки отменяет запрос; бэклог работает; возврат запрашивает снова', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, { delayMs: 2500 }, '/recommend?mode=discover');
    await expect.poll(() => s.calls.get.length).toBe(1);
    await modes(page).getByRole('radio', { name: 'Из бэклога' }).click();
    await expect(page.getByText('Фраза бэклога.')).toBeVisible();
    await expect(page.getByText(/Подбор делается один раз/)).toBeHidden();
    await expect.poll(() => s.aborted).toBe(1);
    s.delayMs = 0;
    await modes(page).getByRole('radio', { name: 'Новое от ИИ' }).click();
    await expect(cardsList(page)).toHaveCount(3);
    expect(s.calls.get).toHaveLength(2);
    expect(await noHScroll(page)).toBe(true);
  });
});

test.describe('QA 13b: гонки скрытия, возврата и обновления', () => {
  test('3 быстрых «Не интересно» с разными задержками + «Обновить»: итог совпадает с сервером', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, { all: nine(), hideDelay: { '1': 600, '2': 50, '3': 300 } });
    await expect(cardsList(page)).toHaveCount(9);
    for (const n of [1, 2, 3]) await page.getByRole('button', { name: `Не интересно: Игра номер ${n}` }).click();
    await page.getByRole('button', { name: /^Обновить подборку/ }).click();
    await expect.poll(() => s.hidden.length).toBe(3);
    await expect(cardsList(page)).toHaveCount(6);
    await expect(page.getByRole('button', { name: /Скрытые на сейчас · 3/ })).toBeVisible();
    await expect(page.getByText(/Обновляю/)).toBeHidden();
    for (const n of [1, 2, 3]) await expect(page.getByRole('listitem', { name: new RegExp(`: Игра номер ${n}$`) })).toHaveCount(0);
  });

  test('«Вернуть» сразу после «Не интересно» и двойной «Вернуть»', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, { unhideDelay: { '1': 400 } });
    await page.getByRole('button', { name: 'Не интересно: Игра номер 1' }).click();
    const blk = page.getByRole('button', { name: /Скрытые на сейчас · 1/ });
    await blk.click();
    const ret = page.getByRole('button', { name: 'Вернуть: Игра номер 1' });
    await ret.dblclick({ force: true });
    await expect(cardsList(page)).toHaveCount(3);
    await expect(page.getByRole('button', { name: /Скрытые на сейчас/ })).toHaveCount(0);
    expect(s.calls.unhide).toEqual(['1']);
    expect(s.hidden).toEqual([]);
  });
});

test.describe('QA 13b: тосты и «В план»', () => {
  test('alert-тост: role=alert с иконкой, обычные остаются status; не больше 3; действие работает', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, { planFail: 1 });
    await page.getByRole('button', { name: 'В план: Игра номер 1' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Не удалось добавить в план. Повтори' });
    await expect(alert).toBeVisible();
    await expect(alert.locator('svg')).toHaveCount(1);
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Добавлено в план: «Игра номер 1»' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Добавлено в план' }).locator('svg')).toHaveCount(0);
    expect(s.calls.plan).toBe(2);
    await expect(page.getByRole('button', { name: 'В план: Игра номер 1' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Уже в плане: Игра номер 1' })).toBeDisabled();
    // стек тостов не растёт выше трёх
    for (const n of [2, 3]) await page.getByRole('button', { name: `Не интересно: Игра номер ${n}` }).click();
    await page.getByRole('button', { name: 'В план: Игра номер 2' }).count();
    expect(await page.locator('.ps-toast').count()).toBeLessThanOrEqual(3);
  });
});

test.describe('QA 13b: раскладка 9 карточек', () => {
  for (const [w, h] of [[1280, 900], [1024, 800], [768, 900], [414, 800], [360, 740], [320, 640]] as const) {
    test(`без горизонтального скролла на ${w}, кнопки не уже 44px на мобильных`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width: w, height: h });
      const all = nine().map((i, k) => ({ ...i, title: `${'Длиннослово'.repeat(k % 3 + 1)} ${i.title}`, platforms: ['PlayStation 5', 'PlayStation 4', 'PlayStation 3', 'PS Vita', 'PlayStation VR'] }));
      await open(page, context, baseURL as string, { all });
      await expect(cardsList(page)).toHaveCount(9);
      expect(await noHScroll(page)).toBe(true);
      if (w < 768) {
        for (const b of await page.locator('.ps-rec--discover .ps-btn').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
        for (const r of await modes(page).getByRole('radio').all()) expect((await r.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
      }
      const cols = await page.locator('ol.ps-rec-list').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(cols).toBe(w >= 1024 ? 3 : 1);
    });
  }
});

test.describe('QA 13b: регресс режима «Из бэклога» и вкладок', () => {
  test('бэклог: сегменты времени работают, шапка 6 вкладок, переходы без ошибок', async ({ page, context, baseURL }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page, context, baseURL as string, {}, '/recommend');
    await expect(page.getByText('Фраза бэклога.')).toBeVisible();
    await page.getByRole('radiogroup', { name: 'Сколько времени есть' }).getByRole('radio').nth(1).click();
    await expect(page).toHaveURL(/time=/);
    await modes(page).getByRole('radio', { name: 'Новое от ИИ' }).click();
    await expect(page).toHaveURL(/mode=discover$/);
    await modes(page).getByRole('radio', { name: 'Из бэклога' }).click();
    await expect(page).toHaveURL(/time=/); // time из состояния страницы восстановлен
    expect(errors).toEqual([]);
  });
});
