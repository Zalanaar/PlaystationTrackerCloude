// Фаза 31: вкладка «У тебя нет» в «Подскажи». API эмулируется по контракту «Фаза 30», остальное через mockApi.
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

type Item = {
  externalSource: 'rawg'; externalId: string; title: string; releaseDate: string | null; coverUrl: string | null; platforms: string[]; genres: string[];
  rating: number | null; metacritic: number | null; rawgUrl: string | null; reason: { text: string; source: 'llm' | 'template' }; planned: boolean; plannedId: number | null;
  catalog?: 'wikidata'; catalogUrl?: string;
};
const item = (id: number, title: string, o: Partial<Item> = {}): Item => ({
  externalSource: 'rawg', externalId: String(id), title, releaseDate: '2019-05-05', coverUrl: null, platforms: ['PS5', 'PS4'], genres: ['ACTION', 'ROLE_PLAYING_GAMES'],
  rating: 4.3, metacritic: 91, rawgUrl: `https://rawg.io/games/g${id}`, reason: { text: `Похожа на «Хейдес» и «Элден Ринг», жанр «Экшен». (${title})`, source: 'template' },
  planned: false, plannedId: null, ...o,
});
type Meta = { catalog: 'ok' | 'unavailable'; generatedAt: string | null; stale: boolean; partial: boolean; reason: 'not_generated' | 'no_candidates' | null; total: number; limit: number };
type St = {
  all: Item[]; hidden: string[]; meta: Partial<Meta>; failGet: number; planFail: boolean; planDuplicate: boolean;
  calls: { get: number; planned: unknown[]; dislike: unknown[]; undislike: string[] };
};
const state = (o: Partial<St> = {}): St => ({
  all: [item(1, 'Нио 2'), item(2, 'Бладборн'), item(3, 'Секиро')], hidden: [], meta: {}, failGet: 0, planFail: false, planDuplicate: false,
  calls: { get: 0, planned: [], dislike: [], undislike: [] }, ...o,
});

async function open(page: Page, context: BrowserContext, baseURL: string, s: St = state(), path = '/recommend?tab=discover'): Promise<St> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, []);
  const ok = (r: Route, data: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  const fail = (r: Route, status: number, code: string) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code, message: 'x' } }) });
  await page.route(/\/api\/recommend$/, (r) => ok(r, { items: [], meta: { llm: 'disabled', candidates: 0, time: 'any', llmPending: 0 } }));
  await page.route(/\/api\/recommend\/dislikes$/, (r) => ok(r, { items: [], ttlDays: 30 }));
  await page.route(/\/api\/recommend\/discover$/, (r) => {
    s.calls.get += 1;
    if (s.failGet > 0) { s.failGet -= 1; return fail(r, 503, 'db_unavailable'); }
    const items = s.all.filter((i) => !s.hidden.includes(i.externalId));
    return ok(r, {
      items, meta: { catalog: 'ok', generatedAt: '2026-10-31T05:00:00.000Z', stale: false, partial: false, reason: items.length ? null : 'no_candidates', total: s.all.length, limit: 12, ...s.meta },
    });
  });
  await page.route('**/api/recommend/discover/dislike', (r) => {
    const b = r.request().postDataJSON() as { externalId: string };
    s.calls.dislike.push(b);
    if (!s.hidden.includes(b.externalId)) s.hidden.push(b.externalId);
    return ok(r, { externalId: b.externalId });
  });
  await page.route(/\/api\/recommend\/discover\/dislike\/[^/]+$/, (r) => {
    const id = decodeURIComponent(r.request().url().split('/').pop() as string);
    s.calls.undislike.push(id);
    s.hidden = s.hidden.filter((x) => x !== id);
    return ok(r, { externalId: id });
  });
  await page.route('**/api/roadmap/planned', (r) => {
    if (r.request().method() !== 'POST') return ok(r, { planned: [] });
    s.calls.planned.push(r.request().postDataJSON());
    if (s.planFail) return fail(r, 503, 'db_unavailable');
    if (s.planDuplicate) return fail(r, 409, 'planned_duplicate');
    return ok(r, { planned: { id: 77 } });
  });
  await page.route('**/api/collection/summary', (r) =>
    ok(r, { totals: { games: 10, playSeconds: 0, hours: 0, trophiesEarned: 0, platinumEarned: 0 }, counts: { all: 10, playing: 0, completed: 0, dropped: 0, backlog: 3, shelved: 0, service: 0, none: 0 }, playing: [], services: [], continue: [], profile: null, nearPlatinum: [] }));
  await page.goto(path);
  return s;
}

const cards = (page: Page) => page.getByTestId('discover-card');
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const tabDiscover = (page: Page) => page.getByRole('tab', { name: 'У тебя нет' });

test.describe('«У тебя нет»', () => {
  test('вкладки, карточка: поля, атрибуция RAWG, без горизонтального скролла', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await expect(tabDiscover(page)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Из бэклога' })).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByText('Игры PlayStation, которых нет в твоей библиотеке')).toBeVisible();
    await expect(cards(page)).toHaveCount(3);
    const first = page.getByRole('listitem', { name: 'Игра 1 из 3: Нио 2' });
    await expect(first.getByText('2019')).toBeVisible();
    await expect(first.getByText('PS5', { exact: true })).toBeVisible();
    await expect(first.getByText('PS4', { exact: true })).toBeVisible();
    await expect(first.getByText('Экшен · Ролевые')).toBeVisible();
    await expect(first.getByText('Metacritic 91 · Пользователи ★ 4,3')).toBeVisible();
    await expect(first.getByText(/Похожа на «Хейдес» и «Элден Ринг»/)).toBeVisible();
    const link = first.getByRole('link', { name: /на RAWG/ });
    await expect(link).toHaveAttribute('href', 'https://rawg.io/games/g1');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(page.getByRole('link', { name: 'RAWG', exact: true })).toHaveAttribute('href', 'https://rawg.io');
    await expect(page.getByText('Подборка от 31 октября')).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
  });

  test('Пакет 7: RAWG недоступен — карточки из Wikidata, ссылка и подпись называют источник', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, state({
      all: [item(1, 'Нио 2'), item(2, 'Призрак Цусимы', { externalId: 'wd-Q42564798', rawgUrl: null, metacritic: null, rating: null, catalog: 'wikidata', catalogUrl: 'https://www.wikidata.org/wiki/Q42564798' })],
    }));
    await expect(cards(page)).toHaveCount(2);
    const wd = cards(page).nth(1);
    const link = wd.getByRole('link', { name: /на Wikidata/ });
    await expect(link).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q42564798');
    await expect(link).toHaveText(/Данные: Wikidata/);
    await expect(cards(page).first().getByRole('link', { name: /на RAWG/ })).toHaveAttribute('href', 'https://rawg.io/games/g1');
    await expect(page.getByRole('link', { name: 'Wikidata', exact: true })).toHaveAttribute('href', 'https://www.wikidata.org');
    await expect(page.getByText(/запасной каталог, пока RAWG недоступен/)).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
  });

  test('переключение вкладок, адрес и клавиатура', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, state(), '/recommend');
    await expect(page.getByRole('tab', { name: 'Из бэклога' })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => s.calls.get).toBe(0); // подборка запрашивается только при открытии вкладки
    await tabDiscover(page).click();
    await expect(page).toHaveURL(/\/recommend\?tab=discover$/);
    await expect(cards(page)).toHaveCount(3);
    await page.getByRole('tab', { name: 'У тебя нет' }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'Из бэклога' })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/\/recommend$/);
    await tabDiscover(page).click();
    await expect(cards(page)).toHaveCount(3);
    expect(s.calls.get).toBe(1); // второй показ без нового запроса
  });

  test('«В План»: запрос с rawg-идентификатором, «Уже в Плане»', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    const first = page.getByRole('listitem', { name: /Нио 2/ });
    await first.getByRole('button', { name: /^В План/ }).click();
    await expect(first.getByRole('button', { name: /Уже в Плане/ })).toBeDisabled();
    await expect(first.getByRole('link', { name: 'Открыть План' })).toBeVisible();
    expect(s.calls.planned[0]).toMatchObject({ title: 'Нио 2', externalSource: 'rawg', externalId: '1', wantAtRelease: false, releaseDate: '2019-05-05' });
  });

  test('«В План»: 409 = уже в Плане; ошибка = тост, карточка остаётся', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, state({ planDuplicate: true }));
    await page.getByRole('listitem', { name: /Нио 2/ }).getByRole('button', { name: /^В План/ }).click();
    await expect(page.getByRole('listitem', { name: /Нио 2/ }).getByRole('button', { name: /Уже в Плане/ })).toBeVisible();
    s.planFail = true; s.planDuplicate = false;
    await page.getByRole('listitem', { name: /Бладборн/ }).getByRole('button', { name: /^В План/ }).click();
    await expect(page.getByText('Не удалось добавить в План. Повтори')).toBeVisible();
    await expect(page.getByRole('listitem', { name: /Бладборн/ }).getByRole('button', { name: /^В План/ })).toBeEnabled();
  });

  test('«Не интересно»: карточка уходит, «Отменить» возвращает', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    await page.getByRole('listitem', { name: /Нио 2/ }).getByRole('button', { name: /Не интересно/ }).click();
    await expect(cards(page)).toHaveCount(2);
    expect(s.calls.dislike[0]).toMatchObject({ externalSource: 'rawg', externalId: '1', title: 'Нио 2', coverUrl: null });
    await expect(page.getByText('Скрыто на 30 дней: «Нио 2»')).toBeVisible();
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(cards(page)).toHaveCount(3);
    expect(s.calls.undislike).toEqual(['1']);
  });

  test('пустые состояния: не создана, всё отфильтровано, каталог недоступен', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, state({ all: [], meta: { reason: 'not_generated', generatedAt: null } }));
    await expect(page.getByRole('heading', { name: 'Подборка ещё не создана' })).toBeVisible();
    await page.getByRole('button', { name: 'Из бэклога' }).click();
    await expect(page.getByRole('tab', { name: 'Из бэклога' })).toHaveAttribute('aria-selected', 'true');
  });
  test('пусто: всё отфильтровано', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, state({ all: [] }));
    await expect(page.getByRole('heading', { name: 'Новых игр пока нет' })).toBeVisible();
  });
  test('каталог недоступен', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, state({ all: [], meta: { catalog: 'unavailable', generatedAt: null } }));
    await expect(page.getByRole('heading', { name: 'Каталог игр недоступен' })).toBeVisible();
  });

  test('ошибка загрузки и повтор', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, state({ failGet: 1 }));
    await expect(page.getByRole('heading', { name: 'Подборка пока недоступна' })).toBeVisible();
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(cards(page)).toHaveCount(3);
  });

  test('пометки: вчерашняя и неполная подборка', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, state({ meta: { stale: true } }));
    await expect(page.getByText('Подборка вчерашняя. Новая появится после ночного синка.')).toBeVisible();
  });
  test('пометка неполной подборки', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, state({ meta: { partial: true } }));
    await expect(page.getByText(/Подборка неполная/)).toBeVisible();
  });

  for (const theme of ['night', 'ps1', 'ps2', 'ps3', 'ps4', 'ps5', 'graphite']) {
    test(`тема ${theme}: карточки читаются, без горизонтального скролла`, async ({ page, context, baseURL }) => {
      await open(page, context, baseURL as string);
      await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, theme);
      await expect(cards(page)).toHaveCount(3);
      await expect(page.getByRole('listitem', { name: /Нио 2/ }).getByRole('button', { name: /^В План/ })).toBeVisible();
      expect(await noHScroll(page)).toBe(true);
    });
  }
});
