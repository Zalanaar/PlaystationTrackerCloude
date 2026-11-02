// Фаза 13: экран /recommend. API «Подскажи» эмулируется по контракту §18, остальное через mockApi.
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

type Item = {
  game: { id: number; name: string; imageUrl: string | null; bannerUrl: string | null; genres: string[]; hours: number | null; hoursSource: 'hltb' | 'manual' | null };
  score: number;
  signals: { key: string; label: string; contribution: number }[];
  reason: { text: string; source: 'llm' | 'template' };
};
const item = (id: number, name: string, o: Partial<Item> = {}): Item => ({
  game: { id, name, imageUrl: null, bannerUrl: null, genres: ['ACTION', 'ADVENTURE'], hours: 22.5, hoursSource: 'hltb' },
  score: 4.7,
  signals: [
    { key: 'genre_affinity', label: 'Любимый жанр: 120 ч, 80% пройдено', contribution: 2.4 },
    { key: 'waiting', label: 'Ждёт в бэклоге давно', contribution: 0.8 },
    { key: 'dropped_genre_penalty', label: 'Часто бросаешь этот жанр', contribution: -1 },
  ],
  reason: { text: `Тебе заходит экшен, и ${name} уйдёт около 22 часов.`, source: 'template' },
  ...o,
});

type Rec = {
  all: Item[]; disliked: number[]; llm: 'ok' | 'disabled' | 'limit' | 'error'; backlogCount: number;
  /** принудительный ответ ошибкой для GET (исчерпывается по одному) */
  fails: number[]; failAlways: number | null; delayMs: number;
  /** сколько дней осталось у скрытых игр (по id), по умолчанию 30 */
  daysLeft: Record<number, number>; failDislikes: boolean;
  calls: { get: string[]; dislikes: number; dislike: number[]; undislike: number[]; status: { id: number; body: unknown }[] };
};
const state = (o: Partial<Rec> = {}): Rec => ({
  all: [item(1, 'Хейдес'), item(2, 'Элден Ринг'), item(3, 'Год оф Вар')], disliked: [], llm: 'disabled', backlogCount: 37, fails: [], failAlways: null, delayMs: 0, daysLeft: {}, failDislikes: false,
  calls: { get: [], dislikes: 0, dislike: [], undislike: [], status: [] }, ...o,
});

async function open(page: Page, context: BrowserContext, baseURL: string, s: Rec = state(), path = '/recommend', games: Parameters<typeof mockApi>[1] = []): Promise<Rec> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, games);
  const ok = (r: Route, data: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  const fail = (r: Route, status: number, code: string) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code, message: 'x' } }) });
  await page.route(/\/api\/recommend(\?.*)?$/, async (r) => {
    const q = new URL(r.request().url()).searchParams.get('time') ?? 'any';
    s.calls.get.push(q);
    if (s.delayMs) await new Promise((x) => setTimeout(x, q === 'short' ? s.delayMs : 0));
    const f = s.fails.shift();
    if (f) return fail(r, f, f === 503 ? 'db_unavailable' : 'internal');
    if (s.failAlways) return fail(r, s.failAlways, s.failAlways === 503 ? 'db_unavailable' : 'internal');
    const items = s.all.filter((i) => !s.disliked.includes(i.game.id)).slice(0, 9);
    return ok(r, { items, meta: { llm: s.llm, candidates: items.length === 0 ? 0 : s.backlogCount, time: q } });
  });
  await page.route(/\/api\/recommend\/dislikes$/, (r) => {
    s.calls.dislikes += 1;
    if (s.failDislikes) return fail(r, 503, 'db_unavailable');
    const base = Date.parse('2026-10-29T10:00:00.000Z');
    const items = s.all.filter((i) => s.disliked.includes(i.game.id)).map((i) => ({
      game: { id: i.game.id, name: i.game.name, imageUrl: i.game.imageUrl, bannerUrl: null, genres: i.game.genres },
      hiddenAt: new Date(base).toISOString(),
      expiresAt: new Date(Date.now() + (s.daysLeft[i.game.id] ?? 30) * 86_400_000 - 3_600_000).toISOString(),
    }));
    return ok(r, { items, ttlDays: 30 });
  });
  await page.route('**/api/recommend/dislike', (r) => {
    const id = (r.request().postDataJSON() as { gameId: number }).gameId;
    s.calls.dislike.push(id);
    if (!s.disliked.includes(id)) s.disliked.push(id);
    return ok(r, { gameId: id });
  });
  await page.route(/\/api\/recommend\/dislike\/\d+$/, (r) => {
    const id = Number(r.request().url().match(/dislike\/(\d+)/)?.[1]);
    s.calls.undislike.push(id);
    s.disliked = s.disliked.filter((x) => x !== id);
    return ok(r, { gameId: id });
  });
  await page.route(/\/api\/games\/\d+\/status$/, (r) => {
    const id = Number(r.request().url().match(/games\/(\d+)\/status/)?.[1]);
    s.calls.status.push({ id, body: r.request().postDataJSON() });
    s.all = s.all.filter((i) => i.game.id !== id); // игра ушла из бэклога
    return ok(r, { game: { id } });
  });
  await page.route('**/api/collection/summary', (r) =>
    ok(r, { totals: { games: 10, playSeconds: 0, hours: 0, trophiesEarned: 0, platinumEarned: 0 }, counts: { all: 10, playing: 0, completed: 0, dropped: 0, backlog: s.backlogCount, shelved: 0, service: 0, none: 0 }, playing: [], services: [], continue: [], profile: null, nearPlatinum: [] }));
  await page.goto(path);
  return s;
}
const h1 = (page: Page) => page.getByRole('heading', { name: 'Подскажи', level: 1 });
const cards = (page: Page) => page.getByRole('listitem').filter({ has: page.getByRole('button', { name: /^Начать играть/ }) });
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('Подскажи: нормальный ответ', () => {
  test('вкладка, три карточки, причина, источник, часы, жанры', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await expect(h1(page)).toBeVisible();
    await expect(page.getByText('Из 37 игр бэклога по твоей истории')).toBeVisible();
    await expect(cards(page)).toHaveCount(3);
    const first = page.getByRole('listitem', { name: 'Рекомендация 1 из 3: Хейдес' });
    await expect(first.getByText('Экшен · Приключения')).toBeVisible();
    await expect(first.getByText('≈ 22 ч 30 м')).toBeVisible();
    await expect(first.getByText('HLTB')).toBeVisible();
    await expect(first.getByText('Тебе заходит экшен, и Хейдес уйдёт около 22 часов.')).toBeVisible();
    await expect(first.getByText('шаблон', { exact: true })).toBeVisible();
    // вкладка активна, без △ и ✕ на экране
    await expect(page.locator('nav[aria-label="Раздел бэклога"] a[href="/recommend"][aria-current="page"]')).toBeAttached();
    const text = await page.locator('main, body').first().innerText();
    expect(text).not.toMatch(/[△✕]/);
    expect(await noHScroll(page)).toBe(true);
  });

  test('раскрывашка: свёрнута по умолчанию, сигналы со знаком и числом, итоговый балл', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    const first = page.getByRole('listitem', { name: 'Рекомендация 1 из 3: Хейдес' });
    const toggle = first.getByRole('button', { name: /Почему эта игра/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(first.getByText('+2,4')).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(first.getByText('+2,4')).toBeVisible();
    await expect(first.getByText('−1,0')).toBeVisible();
    await expect(first.getByText('Любимый жанр: 120 ч, 80% пройдено')).toBeVisible();
    await expect(first.getByText('Итоговый балл: 4,7')).toBeVisible();
    const keys = await first.locator('[data-signal]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.signal));
    expect(keys).toEqual(['genre_affinity', 'waiting', 'dropped_genre_penalty']); // порядок API
  });

  test('источник llm: «ИИ-формулировка» с пояснением', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, state({ all: [item(1, 'Хейдес', { reason: { text: 'Фраза.', source: 'llm' } })], llm: 'ok' }));
    const first = page.getByRole('listitem', { name: 'Рекомендация 1 из 1: Хейдес' });
    await expect(first.getByText('ИИ-формулировка')).toHaveAttribute('title', 'Игру выбрал расчёт по твоей истории, ИИ только переписал фразу');
    await expect(page.getByText('Подходящих игр в бэклоге: 37')).toBeVisible();
  });

  test('нет часов и жанров: «Длительность неизвестна», строка жанров скрыта', async ({ page, context, baseURL }) => {
    const it = item(1, 'Хейдес');
    it.game.hours = null; it.game.hoursSource = null; it.game.genres = [];
    await open(page, context, baseURL as string, state({ all: [it] }));
    const first = page.getByRole('listitem', { name: /Хейдес/ });
    await expect(first.getByText('Длительность неизвестна')).toBeVisible();
    await expect(first.locator('.ps-rec__genres')).toHaveCount(0);
  });

  test('название открывает окно игры', async ({ page, context, baseURL }) => {
    // игра должна быть в библиотеке: на 404 окно закрывается и возвращает на страницу (R-2)
    await open(page, context, baseURL as string, state(), '/recommend', seed().filter((g) => g.id === 1));
    await page.getByRole('button', { name: 'Хейдес', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});

test.describe('Подскажи: выбор времени', () => {
  test('сегмент меняет выдачу и URL; any без параметра; клавиатура', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    await expect(cards(page)).toHaveCount(3);
    const group = page.getByRole('radiogroup', { name: 'Сколько времени есть' });
    await expect(group.getByRole('radio', { checked: true })).toContainText('Любое');
    await group.getByRole('radio', { name: /^Короткая/ }).click();
    await expect(page).toHaveURL(/\/recommend\?time=short$/);
    await expect.poll(() => s.calls.get).toEqual(['any', 'short']);
    await expect(group.getByRole('radio', { name: /^Короткая/ })).toHaveAttribute('aria-checked', 'true');
    // стрелка вправо выбирает и применяет, Home возвращает к any
    await group.getByRole('radio', { name: /^Короткая/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/time=medium$/);
    await expect(group.getByRole('radio', { name: /^Средняя/ })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page).toHaveURL(/\/recommend$/);
    expect(s.calls.get.at(-1)).toBe('any');
    // roving tabindex
    await expect(group.getByRole('radio', { name: /^Любое/ })).toHaveAttribute('tabindex', '0');
    await expect(group.getByRole('radio', { name: /^Долгая/ })).toHaveAttribute('tabindex', '-1');
  });

  test('time из URL применяется; неизвестное значение заменяется на any и на сервер не уходит', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, state(), '/recommend?time=long');
    await expect(page.getByRole('radio', { name: /^Долгая/ })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => s.calls.get).toEqual(['long']);
    const s2 = await open(page, context, baseURL as string, state(), '/recommend?time=bogus');
    await expect(page).toHaveURL(/\/recommend$/);
    await expect(cards(page)).toHaveCount(3);
    await expect.poll(() => s2.calls.get).toEqual(['any']);
  });

  test('быстрая смена: ответ устаревшего запроса отбрасывается, индикатор «Подбираю…»', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, state({ delayMs: 600 }));
    await expect(cards(page)).toHaveCount(3);
    await page.getByRole('radio', { name: /^Короткая/ }).click();
    await expect(page.getByText('Подбираю…')).toBeVisible();
    await page.getByRole('radio', { name: /^Средняя/ }).click();
    await expect(page.getByText('Подбираю…')).toBeHidden();
    await expect.poll(() => s.calls.get).toEqual(['any', 'short', 'medium']);
    await page.waitForTimeout(800);
    await expect(page.getByRole('radio', { name: /^Средняя/ })).toHaveAttribute('aria-checked', 'true');
    await expect(cards(page)).toHaveCount(3);
  });
});

test.describe('Подскажи: действия', () => {
  test('«Начать играть»: PUT playing, тост со ссылкой, перезапрос', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    await page.getByRole('button', { name: 'Начать играть: Хейдес' }).click();
    await expect(page.getByText('«Хейдес» теперь в «Играю»')).toBeVisible();
    await expect(page.getByRole('button', { name: 'К коллекции' })).toBeVisible();
    expect(s.calls.status).toEqual([{ id: 1, body: { status: 'playing' } }]);
    await expect(cards(page)).toHaveCount(2);
    expect(s.calls.get).toEqual(['any', 'any']);
  });

  test('кнопки блокируются на время запроса', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await page.route(/\/api\/games\/\d+\/status$/, async (r) => {
      await new Promise((x) => setTimeout(x, 500));
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { game: { id: 1 } } }) });
    });
    const start = page.getByRole('button', { name: 'Начать играть: Хейдес' });
    await start.click();
    await expect(start).toBeDisabled();
    await expect(start).toContainText('Запускаю…');
    await expect(page.getByRole('button', { name: 'Не интересно: Хейдес' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Не интересно: Элден Ринг' })).toBeEnabled();
  });

  test('«Не интересно» скрывает, «Отменить» возвращает', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    await page.getByRole('button', { name: 'Не интересно: Хейдес' }).click();
    await expect(page.getByText('Скрыто на 30 дней: «Хейдес»')).toBeVisible();
    expect(s.calls.dislike).toEqual([1]);
    await expect(page.getByRole('listitem', { name: /Хейдес/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByRole('listitem', { name: /Хейдес/ })).toHaveCount(1);
    expect(s.calls.undislike).toEqual([1]);
  });

  test('ошибка действия: тост «Повторить», карточка возвращается', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await page.route('**/api/recommend/dislike', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'db_unavailable', message: 'x' } }) }));
    await page.getByRole('button', { name: 'Не интересно: Хейдес' }).click();
    await expect(page.getByText('Не удалось скрыть игру. Повтори')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Не интересно: Хейдес' })).toBeEnabled();
    await expect(cards(page)).toHaveCount(3);
  });

  test('404 при действии: тост «Игры уже нет в библиотеке» и перезапрос', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    await page.route('**/api/recommend/dislike', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'not_found', message: 'x' } }) }));
    await page.getByRole('button', { name: 'Не интересно: Хейдес' }).click();
    await expect(page.getByText('Игры уже нет в библиотеке')).toBeVisible();
    await expect.poll(() => s.calls.get.length).toBe(2);
  });
});

test.describe('Подскажи: состояния', () => {
  test('скелеты при первой загрузке и подсказка о долгом подборе не мешают', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL as string }]);
    await mockApi(page, []);
    await page.route(/\/api\/recommend(\?.*)?$/, async (r) => {
      await new Promise((x) => setTimeout(x, 700));
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { items: [], meta: { llm: 'disabled', candidates: 0, time: 'any' } } }) });
    });
    await page.goto('/recommend');
    const wide = (page.viewportSize()?.width ?? 0) >= 1024; // 9 скелетов в сетке 3x3, на узких 3
    await expect(page.locator('.ps-rec--sk')).toHaveCount(wide ? 9 : 3);
    await expect(page.locator('ol[aria-busy="true"]')).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Сколько времени есть' })).toBeVisible();
  });

  test('бэклог пуст', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, state({ all: [], backlogCount: 0 }));
    await expect(page.getByRole('heading', { name: 'В бэклоге пусто' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'К коллекции' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('radiogroup', { name: 'Сколько времени есть' })).toHaveCount(0);
    await expect(page.getByText(/^Из \d+ игр/)).toHaveCount(0);
  });

  test('все скрыты: панель ведёт к блоку «Скрытые», возврат из блока', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, state({ all: [item(1, 'Хейдес'), item(2, 'Элден Ринг')], backlogCount: 2 }));
    await page.getByRole('button', { name: 'Не интересно: Хейдес' }).click();
    await expect(cards(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Не интересно: Элден Ринг' }).click();
    await expect(page.getByRole('heading', { name: 'Подсказывать нечего: все игры бэклога скрыты' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Вернуть скрытые/ })).toHaveCount(0);
    const toggle = page.getByRole('button', { name: /Скрытые на сейчас · 2/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Показать скрытые: 2' }).click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toBeFocused();
    await page.getByRole('button', { name: 'Вернуть: Хейдес' }).click();
    await expect(cards(page)).toHaveCount(1);
    expect(s.calls.undislike).toEqual([1]);
  });

  test('пустое состояние после перезагрузки: скрытые приходят с сервера, а не из сессии', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, state({ all: [item(1, 'Хейдес')], disliked: [1], backlogCount: 1 }));
    await expect(page.getByRole('heading', { name: 'Подсказывать нечего: все игры бэклога скрыты' })).toBeVisible();
    await page.getByRole('button', { name: 'Показать скрытые: 1' }).click();
    await page.getByRole('button', { name: 'Вернуть: Хейдес' }).click();
    await expect(cards(page)).toHaveCount(1);
    expect(s.calls.undislike).toEqual([1]);
  });
  test('503 на первой загрузке: панель, выбор времени виден, «Повторить» работает', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, state({ fails: [503] }));
    await expect(page.getByRole('heading', { name: 'Подсказки пока недоступны' })).toBeVisible();
    await expect(page.getByText('Не получилось обратиться к базе данных. Это временно.')).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Сколько времени есть' })).toBeVisible();
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(cards(page)).toHaveCount(3);
    expect(s.calls.get).toEqual(['any', 'any']);
  });

  test('сеть/500 на первой загрузке: общий текст', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, state({ fails: [500] }));
    await expect(page.getByRole('heading', { name: 'Не удалось загрузить подсказки' })).toBeVisible();
    await expect(page.getByText('Проверь соединение и попробуй ещё раз.')).toBeVisible();
  });

  test('перезапрос упал: прежние карточки и баннер, действия работают', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    await expect(cards(page)).toHaveCount(3);
    s.fails.push(503);
    await page.getByRole('radio', { name: /^Короткая/ }).click();
    await expect(page.getByText('Не удалось обновить подсказки. Показаны прежние.')).toBeVisible();
    await expect(cards(page)).toHaveCount(3);
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByText('Не удалось обновить подсказки. Показаны прежние.')).toBeHidden();
  });

  test('llm limit и error: спокойная строка под карточками, карточки полноценные', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, state({ llm: 'limit' }));
    await expect(page.getByText('Формулировки сегодня по шаблону: дневной лимит ИИ исчерпан.')).toBeVisible();
    await expect(cards(page)).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Начать играть: Хейдес' })).toBeEnabled();
    await open(page, context, baseURL as string, state({ llm: 'error' }));
    await expect(page.getByText('Формулировки временно по шаблону.')).toBeVisible();
  });

  test('llm ok и disabled: строки нет', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, state({ llm: 'ok' }));
    await expect(cards(page)).toHaveCount(3);
    await expect(page.getByText(/Формулировки/)).toHaveCount(0);
  });
});

test.describe('Подскажи: 9 карточек и блок «Скрытые на сейчас»', () => {
  const nine = Array.from({ length: 12 }, (_, i) => item(i + 1, `Игра ${i + 1}`));

  test('9 карточек: 3 колонки x 3 ряда на десктопе, без горизонтального скролла', async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, context, baseURL as string, state({ all: nine }));
    await expect(cards(page)).toHaveCount(9);
    const pos = await cards(page).evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }));
    expect(new Set(pos.map((p) => p[0])).size).toBe(3);
    expect(new Set(pos.map((p) => p[1])).size).toBe(3);
    await expect(page.getByText('Подходящих игр в бэклоге')).toHaveCount(0);
    expect(await noHScroll(page)).toBe(true);
  });

  test('9 карточек на 360: одна колонка', async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await open(page, context, baseURL as string, state({ all: nine }));
    await expect(cards(page)).toHaveCount(9);
    expect(await noHScroll(page)).toBe(true);
  });

  test('блока нет, когда скрытых нет', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    await expect(cards(page)).toHaveCount(3);
    await expect.poll(() => s.calls.dislikes).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: /Скрытые на сейчас/ })).toHaveCount(0);
  });

  test('блок закрыт по умолчанию: строка с названием, «вернётся через N дн.», «Вернуть»', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, state({ disliked: [2], daysLeft: { 2: 12 } }));
    await expect(cards(page)).toHaveCount(2);
    const toggle = page.getByRole('button', { name: /Скрытые на сейчас · 1/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: 'Вернуть: Элден Ринг' })).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const row = page.locator('.ps-rec-hid__row').filter({ hasText: 'Элден Ринг' });
    await expect(row).toBeVisible();
    await expect(row.getByText('вернётся через 12 дн.')).toBeVisible();
    await expect(toggle).toContainText('Скрыто на 30 дней');
    expect(await noHScroll(page)).toBe(true);
    expect(s.calls.undislike).toEqual([]);
  });

  test('«Вернуть»: DELETE и перезапрос обоих списков, блок исчезает при 0', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, state({ disliked: [2] }));
    await page.getByRole('button', { name: /Скрытые на сейчас · 1/ }).click();
    const gets = s.calls.get.length;
    const lists = s.calls.dislikes;
    await page.getByRole('button', { name: 'Вернуть: Элден Ринг' }).click();
    await expect(page.getByText('«Элден Ринг» снова в подсказках')).toBeVisible();
    expect(s.calls.undislike).toEqual([2]);
    await expect(cards(page)).toHaveCount(3);
    expect(s.calls.get.length).toBe(gets + 1);
    expect(s.calls.dislikes).toBe(lists + 1);
    await expect(page.getByRole('button', { name: /Скрытые на сейчас/ })).toHaveCount(0);
  });

  test('скрытие добавляет игру в блок; ошибка списка скрытых не ломает экран', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, state({ failDislikes: true }));
    await expect(cards(page)).toHaveCount(3);
    await expect(page.getByRole('button', { name: /Скрытые на сейчас/ })).toHaveCount(0);
    const s2 = await open(page, context, baseURL as string);
    await page.getByRole('button', { name: 'Не интересно: Хейдес' }).click();
    await expect(page.getByRole('button', { name: /Скрытые на сейчас · 1/ })).toBeVisible();
    expect(s2.calls.dislike).toEqual([1]);
  });
});

test.describe('Подскажи: адаптив', () => {
  for (const [w, h] of [[1280, 800], [1024, 800], [768, 900], [360, 740], [320, 640]] as const) {
    test(`${w}px: без горизонтального скролла, раскрывашка открыта`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width: w, height: h });
      await open(page, context, baseURL as string);
      await expect(cards(page)).toHaveCount(3);
      await page.getByRole('button', { name: /Почему эта игра/ }).first().click();
      expect(await noHScroll(page)).toBe(true);
      // на 3 колонках карточки в одном ряду, ниже 1024 в одной колонке
      const tops = await cards(page).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      if (w >= 1024) expect(new Set(tops).size).toBe(1);
      else expect(new Set(tops).size).toBe(3);
    });
  }

  for (const w of [360, 320]) {
    test(`tab bar ${w}px: 4 вкладки помещаются, «Бэклог» активна, «Подскажи» в подвкладках`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width: w, height: 740 });
      await open(page, context, baseURL as string);
      const bar = page.locator('nav.ps-tabbar');
      await expect(bar.locator('a')).toHaveCount(4);
      await expect(bar.locator('a[aria-current="page"]')).toContainText('Бэклог');
      await expect(page.locator('nav[aria-label="Раздел бэклога"] a[aria-current="page"]')).toHaveText('Подскажи');
      const over = await bar.locator('a').evaluateAll((els) => els.map((e) => {
        const t = Array.from(e.querySelectorAll('span')).find((s) => getComputedStyle(s).display !== 'none') as HTMLElement;
        return t.scrollWidth > e.clientWidth ? `${t.textContent}:${t.scrollWidth}>${e.clientWidth}` : '';
      }));
      expect(over.filter(Boolean)).toEqual([]);
      await expect(bar.getByRole('link', { name: 'Статистика' })).toContainText('Статистика');
    });
  }
});
