// Фаза 13b: режим «Новое от ИИ» на /recommend. API эмулируется по контракту §19 (+ §17.7 для «В план»).
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

type DItem = {
  externalSource: 'rawg'; externalId: string; title: string; releaseDate: string | null; coverUrl: string | null;
  platforms: string[]; reason: string; planned: boolean; plannedId: number | null;
};
type Meta = { llm: 'ok' | 'disabled' | 'limit' | 'error'; catalog: 'ok' | 'unavailable'; cached: boolean; generatedAt: string | null; refreshLeft: number; verified: number; proposed: number };
const dItem = (id: string, title: string, o: Partial<DItem> = {}): DItem => ({
  externalSource: 'rawg', externalId: id, title, releaseDate: '2015-05-18', coverUrl: null, platforms: ['PC', 'PlayStation 4', 'PlayStation 5'],
  reason: `Тебе заходят большие сюжетные игры, поэтому ${title} подойдёт.`, planned: false, plannedId: null, ...o,
});

type St = {
  all: DItem[]; hidden: string[]; meta: Meta; delayMs: number; refreshDelayMs: number;
  /** ответы GET discover по очереди: статус ошибки или 'abort' */
  fails: (number | 'abort')[]; planned409: string[]; planFail: number; hideFail: number; dislikesFail: boolean; hangFirst: boolean;
  calls: { get: string[]; plan: unknown[]; hide: unknown[]; unhide: string[]; dislikes: number; backlog: number };
};
const meta = (o: Partial<Meta> = {}): Meta => ({ llm: 'ok', catalog: 'ok', cached: true, generatedAt: '2026-10-29T10:00:00.000Z', refreshLeft: 3, verified: 11, proposed: 15, ...o });
const st = (o: Partial<St> = {}): St => ({
  all: [dItem('3328', 'The Witcher 3: Wild Hunt'), dItem('4200', 'Portal 2', { releaseDate: '2099-01-01', platforms: ['PlayStation 3'] }), dItem('5000', 'Без даты', { releaseDate: null, platforms: ['PC'] })],
  hidden: [], meta: meta(), delayMs: 0, refreshDelayMs: 0, fails: [], planned409: [], planFail: 0, hideFail: 0, dislikesFail: false, hangFirst: false,
  calls: { get: [], plan: [], hide: [], unhide: [], dislikes: 0, backlog: 0 }, ...o,
});

async function open(page: Page, context: BrowserContext, baseURL: string, s: St = st(), path = '/recommend?mode=discover'): Promise<St> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, []);
  const ok = (r: Route, data: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  const fail = (r: Route, status: number, code: string) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code, message: 'x' } }) });
  // режим «Из бэклога»: один ответ, нужен только для переключения
  await page.route(/\/api\/recommend(\?.*)?$/, (r) => {
    s.calls.backlog += 1;
    return ok(r, { items: [{
      game: { id: 1, name: 'Хейдес', imageUrl: null, bannerUrl: null, genres: ['ACTION'], hours: 22.5, hoursSource: 'hltb' }, score: 4.7, signals: [],
      reason: { text: 'Фраза бэклога.', source: 'template' },
    }], meta: { llm: 'disabled', candidates: 37, time: 'any' } });
  });
  await page.route(/\/api\/recommend\/dislikes$/, (r) => ok(r, { items: [], ttlDays: 30 }));
  await page.route(/\/api\/recommend\/discover(\?.*)?$/, async (r) => {
    const url = new URL(r.request().url());
    const refresh = url.searchParams.get('refresh');
    s.calls.get.push(refresh ? `refresh=${refresh}` : 'plain');
    if (s.hangFirst) { s.hangFirst = false; return; } // запрос повисает до клиентского таймаута
    const wait = refresh ? s.refreshDelayMs : s.delayMs;
    if (wait) await new Promise((x) => setTimeout(x, wait));
    const f = s.fails.shift();
    if (f === 'abort') return r.abort('failed');
    if (f) return fail(r, f, f === 503 ? 'db_unavailable' : 'internal');
    if (refresh) s.meta = { ...s.meta, cached: false, refreshLeft: Math.max(0, s.meta.refreshLeft - 1) };
    const items = s.all.filter((i) => !s.hidden.includes(i.externalId));
    return ok(r, { items, meta: s.meta });
  });
  await page.route(/\/api\/recommend\/discover\/dislikes$/, (r) => {
    s.calls.dislikes += 1;
    if (s.dislikesFail) return fail(r, 503, 'db_unavailable');
    const items = s.all.filter((i) => s.hidden.includes(i.externalId)).map((i) => ({
      externalSource: 'rawg', externalId: i.externalId, title: i.title, coverUrl: i.coverUrl, hiddenAt: '2026-10-29T10:00:00.000Z',
      expiresAt: new Date(Date.now() + 12 * 86_400_000 - 3_600_000).toISOString(),
    }));
    return ok(r, { items, ttlDays: 30 });
  });
  await page.route(/\/api\/recommend\/discover\/dislike$/, (r) => {
    const b = r.request().postDataJSON() as { externalId: string };
    s.calls.hide.push(b);
    if (s.hideFail > 0) { s.hideFail -= 1; return fail(r, 503, 'db_unavailable'); }
    if (!s.hidden.includes(b.externalId)) s.hidden.push(b.externalId);
    return ok(r, { externalId: b.externalId });
  });
  await page.route(/\/api\/recommend\/discover\/dislike\/[^/]+$/, (r) => {
    const id = decodeURIComponent(r.request().url().split('/').pop() as string);
    s.calls.unhide.push(id);
    s.hidden = s.hidden.filter((x) => x !== id);
    return ok(r, { externalId: id });
  });
  await page.route(/\/api\/roadmap\/planned$/, (r) => {
    if (r.request().method() !== 'POST') return ok(r, { planned: [] });
    const b = r.request().postDataJSON() as { externalId: string };
    s.calls.plan.push(b);
    if (s.planFail > 0) { s.planFail -= 1; return fail(r, 503, 'db_unavailable'); }
    if (s.planned409.includes(b.externalId)) return r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'planned_duplicate', message: 'x', details: { id: 7 } } }) });
    return ok(r, { planned: { id: 7, ...b, status: 'planned' } });
  });
  await page.goto(path);
  return s;
}

const card = (page: Page, n: number, total: number, title: string) => page.getByRole('listitem', { name: `Новая игра ${n} из ${total}: ${title}` });
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const modes = (page: Page) => page.getByRole('radiogroup', { name: 'Режим подсказок' });
const refreshBtn = (page: Page) => page.getByRole('button', { name: /Обновить подборку|Обновляю/ });

test.describe('Новое от ИИ: переключатель режимов', () => {
  test('по умолчанию бэклог, discover не запрашивается; переключение меняет URL и сохраняет ответ', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, st(), '/recommend');
    await expect(page.getByRole('heading', { name: 'Подскажи', level: 1 })).toBeVisible();
    await expect(modes(page).getByRole('radio', { checked: true })).toHaveText('Из бэклога');
    await expect(page.getByText('Из 37 игр бэклога по твоей истории')).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Сколько времени есть' })).toBeVisible();
    expect(s.calls.get).toEqual([]);

    await modes(page).getByRole('radio', { name: 'Новое от ИИ' }).click();
    await expect(page).toHaveURL(/\/recommend\?mode=discover$/);
    await expect(card(page, 1, 3, 'The Witcher 3: Wild Hunt')).toBeVisible();
    await expect(page.getByText('Игры, которых нет в твоей библиотеке')).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Сколько времени есть' })).toBeHidden();
    await expect(page.getByText('Режим: Новое от ИИ')).toBeAttached();
    expect(s.calls.get).toEqual(['plain']);

    await modes(page).getByRole('radio', { name: 'Из бэклога' }).click();
    await expect(page).toHaveURL(/\/recommend$/);
    await expect(page.getByRole('radiogroup', { name: 'Сколько времени есть' })).toBeVisible();
    await expect(card(page, 1, 3, 'The Witcher 3: Wild Hunt')).toBeHidden();

    // возврат: прежние карточки сразу, затем тихий перезапрос без refresh
    await modes(page).getByRole('radio', { name: 'Новое от ИИ' }).click();
    await expect(card(page, 1, 3, 'The Witcher 3: Wild Hunt')).toBeVisible();
    await expect.poll(() => s.calls.get).toEqual(['plain', 'plain']);
  });

  test('?mode=discover открывает режим без запроса бэклога; мусор и backlog сбрасываются; time удаляется', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, st(), '/recommend?mode=discover&time=short');
    await expect(card(page, 1, 3, 'The Witcher 3: Wild Hunt')).toBeVisible();
    await expect(page).toHaveURL(/\/recommend\?mode=discover$/);
    expect(s.calls.backlog).toBe(0);
    expect(s.calls.get).toEqual(['plain']);
    const s2 = await open(page, context, baseURL as string, st(), '/recommend?mode=zzz');
    await expect(page).toHaveURL(/\/recommend$/);
    await expect(modes(page).getByRole('radio', { checked: true })).toHaveText('Из бэклога');
    expect(s2.calls.get).toEqual([]);
    await open(page, context, baseURL as string, st(), '/recommend?mode=backlog');
    await expect(page).toHaveURL(/\/recommend$/);
  });

  test('клавиатура: стрелки/Home/End выбирают режим, roving tabindex', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, st(), '/recommend');
    const r = modes(page).getByRole('radio');
    await expect(r.nth(0)).toHaveAttribute('tabindex', '0');
    await expect(r.nth(1)).toHaveAttribute('tabindex', '-1');
    await r.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/mode=discover$/);
    await expect(r.nth(1)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page).toHaveURL(/\/recommend$/);
    await expect(r.nth(0)).toBeFocused();
  });
});

test.describe('Новое от ИИ: карточки', () => {
  test('поля карточки, подпись источника, платформы, дата, нет текста на обложке', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await expect(page.getByText('Подборка от сегодня,').or(page.getByText('Подборка от 29 октября'))).toBeVisible();
    const c1 = card(page, 1, 3, 'The Witcher 3: Wild Hunt');
    await expect(c1.getByRole('heading', { name: 'The Witcher 3: Wild Hunt' })).toBeVisible();
    await expect(c1.getByText('Выход: 18 мая 2015')).toBeVisible();
    await expect(c1.getByText('PS5 · PS4', { exact: true })).toBeVisible();
    await expect(c1.getByText(/Тебе заходят большие сюжетные игры/)).toBeVisible();
    await expect(c1.getByText('Подобрано ИИ, данные')).toBeVisible();
    const link = c1.getByRole('link', { name: 'Данные: RAWG (откроется в новой вкладке)' });
    await expect(link).toHaveAttribute('href', 'https://rawg.io');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // будущая дата, нет даты, нет PlayStation
    const c2 = card(page, 2, 3, 'Portal 2');
    await expect(c2.getByText('ещё не вышла')).toBeVisible();
    await expect(c2.getByText('PS3', { exact: true })).toBeVisible();
    const c3 = card(page, 3, 3, 'Без даты');
    await expect(c3.getByText('Дата выхода не объявлена')).toBeVisible();
    await expect(c3.locator('.ps-rec__genres')).toHaveCount(0);
    await expect(page.getByText('Подтверждено в каталоге: 11 из 15; показано: 3')).toBeVisible();
    const text = await page.locator('main, body').first().innerText();
    expect(text).not.toMatch(/[△✕]/);
    expect(await noHScroll(page)).toBe(true);
  });

  test('устаревшая подборка: дата другого дня, без отдельной заметки', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, st({ meta: meta({ generatedAt: '2026-10-27T10:00:00.000Z' }) }));
    await expect(page.getByText('Подборка от 27 октября')).toBeVisible();
    await expect(page.locator('.ps-rec-note--ic')).toHaveCount(0);
  });
});

test.describe('Новое от ИИ: «В план»', () => {
  test('POST по контракту, затем «Уже в плане» без перезапроса и тост', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    const c = card(page, 1, 3, 'The Witcher 3: Wild Hunt');
    await c.getByRole('button', { name: 'В план: The Witcher 3: Wild Hunt' }).click();
    await expect(page.getByText('Добавлено в план: «The Witcher 3: Wild Hunt»')).toBeVisible();
    await expect(c.getByRole('button', { name: /Уже в плане/ })).toBeDisabled();
    await expect(c.getByRole('link', { name: 'Открыть план' })).toHaveAttribute('href', '/roadmap');
    expect(s.calls.plan).toEqual([{
      title: 'The Witcher 3: Wild Hunt', releaseDate: '2015-05-18', coverUrl: null, wantAtRelease: false, hoursManual: null, externalSource: 'rawg', externalId: '3328',
    }]);
    expect(s.calls.get).toEqual(['plain']);
    await expect(card(page, 1, 3, 'The Witcher 3: Wild Hunt')).toBeVisible();
  });

  test('planned: true из API сразу «Уже в плане»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, st({ all: [dItem('1', 'Игра А', { planned: true, plannedId: 5 }), dItem('2', 'Игра Б')] }));
    const c = card(page, 1, 2, 'Игра А');
    await expect(c.getByRole('button', { name: /Уже в плане/ })).toBeDisabled();
    await expect(c.getByRole('button', { name: /^В план:/ })).toHaveCount(0);
    await expect(card(page, 2, 2, 'Игра Б').getByRole('button', { name: 'В план: Игра Б' })).toBeEnabled();
  });

  test('409 planned_duplicate: не ошибка, «Уже в плане» и тост', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, st({ planned409: ['3328'] }));
    const c = card(page, 1, 3, 'The Witcher 3: Wild Hunt');
    await c.getByRole('button', { name: /^В план:/ }).click();
    await expect(page.getByText('Эта игра уже в плане')).toBeVisible();
    await expect(c.getByRole('button', { name: /Уже в плане/ })).toBeDisabled();
    await expect(page.locator('.ps-toast svg')).toHaveCount(0);
  });

  test('ошибка: карточка в обычном состоянии, тост с «Повторить», повтор проходит', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, st({ planFail: 1 }));
    const c = card(page, 1, 3, 'The Witcher 3: Wild Hunt');
    await c.getByRole('button', { name: /^В план:/ }).click();
    await expect(page.getByText('Не удалось добавить в план. Повтори')).toBeVisible();
    await expect(page.locator('.ps-toast svg')).toHaveCount(1);
    await expect(c.getByRole('button', { name: /^В план:/ })).toBeEnabled();
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(c.getByRole('button', { name: /Уже в плане/ })).toBeDisabled();
    expect(s.calls.plan).toHaveLength(2);
  });
});

test.describe('Новое от ИИ: «Не интересно» и скрытые', () => {
  test('скрытие убирает карточку, тост «Скрыто на 30 дней», «Отменить» возвращает на место', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    await card(page, 2, 3, 'Portal 2').getByRole('button', { name: 'Не интересно: Portal 2' }).click();
    await expect(page.getByText('Скрыто на 30 дней: «Portal 2»')).toBeVisible();
    await expect(page.getByRole('listitem', { name: /Portal 2/ })).toHaveCount(0);
    expect(s.calls.hide).toEqual([{ externalSource: 'rawg', externalId: '4200', title: 'Portal 2', coverUrl: null }]);
    await expect(page.getByText('Подтверждено в каталоге: 11 из 15; показано: 2')).toBeVisible();
    expect(s.calls.get.every((c) => c === 'plain')).toBe(true);
    // блок скрытых со своим счётчиком, закрыт по умолчанию
    const block = page.getByRole('button', { name: /Скрытые на сейчас · 1/ });
    await expect(block).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect.poll(() => s.calls.unhide).toEqual(['4200']);
    await expect(card(page, 2, 3, 'Portal 2')).toBeVisible();
    await expect(page.getByRole('button', { name: /Скрытые на сейчас/ })).toHaveCount(0);
    expect(s.calls.get.every((c) => c === 'plain')).toBe(true);
  });

  test('блок «Скрытые на сейчас»: срок, «Вернуть», тост', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    await card(page, 1, 3, 'The Witcher 3: Wild Hunt').getByRole('button', { name: /^Не интересно:/ }).click();
    const block = page.getByRole('button', { name: /Скрытые на сейчас · 1/ });
    await block.click();
    await expect(block).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('вернётся через 12 дн.')).toBeVisible();
    await page.getByRole('button', { name: 'Вернуть: The Witcher 3: Wild Hunt' }).click();
    await expect(page.getByText('«The Witcher 3: Wild Hunt» снова в подсказках')).toBeVisible();
    await expect(card(page, 1, 3, 'The Witcher 3: Wild Hunt')).toBeVisible();
    expect(s.calls.unhide).toEqual(['3328']);
  });

  test('ошибка скрытия: карточка остаётся, тост с «Повторить»', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, st({ hideFail: 1 }));
    const c = card(page, 1, 3, 'The Witcher 3: Wild Hunt');
    await c.getByRole('button', { name: /^Не интересно:/ }).click();
    await expect(page.getByText('Не удалось скрыть игру. Повтори')).toBeVisible();
    await expect(c).toBeVisible();
    await expect(c.getByRole('button', { name: /^Не интересно:/ })).toBeEnabled();
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByRole('listitem', { name: /The Witcher 3/ })).toHaveCount(0);
    expect(s.calls.hide).toHaveLength(2);
  });

  test('ошибка списка скрытых: блока нет, экран работает', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, st({ dislikesFail: true }));
    await expect(card(page, 1, 3, 'The Witcher 3: Wild Hunt')).toBeVisible();
    await expect(page.getByRole('button', { name: /Скрытые на сейчас/ })).toHaveCount(0);
  });
});

test.describe('Новое от ИИ: «Обновить подборку»', () => {
  test('показывает остаток; refresh=1 только по нажатию; новый остаток; объявление', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    await expect(refreshBtn(page)).toHaveText(/Обновить подборку\s*· осталось 3/);
    expect(s.calls.get).toEqual(['plain']);
    await refreshBtn(page).click();
    await expect(refreshBtn(page)).toHaveText(/осталось 2/);
    expect(s.calls.get).toEqual(['plain', 'refresh=1']);
    await expect(page.getByText('Подборка обновлена: 3 игры')).toBeAttached();
  });

  test('refreshLeft = 0: кнопка выключена, «лимит на сегодня», пояснение в title', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, st({ meta: meta({ refreshLeft: 0 }) }));
    const b = refreshBtn(page);
    await expect(b).toBeDisabled();
    await expect(b).toContainText('лимит на сегодня');
    await expect(b).toHaveAttribute('title', 'Обновить можно 3 раза в сутки. Лимит обновится завтра');
  });

  test('во время обновления: «Обновляю…», карточки на месте, панель прогресса с этапом; после — без панели', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, st({ refreshDelayMs: 1500 }));
    await refreshBtn(page).click();
    await expect(page.getByRole('button', { name: 'Обновляю…' })).toBeDisabled();
    await expect(page.getByText('Смотрю, что тебе заходило…').first()).toBeVisible();
    await expect(card(page, 1, 3, 'The Witcher 3: Wild Hunt')).toBeVisible();
    await expect(page.locator('.ps-rec-list')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByText('Смотрю, что тебе заходило…').first()).toBeHidden();
    await expect(refreshBtn(page)).toHaveText(/осталось 2/);
  });

  test('быстрый ответ из кэша: панель прогресса не мигает', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, st({ delayMs: 200 }));
    await expect(card(page, 1, 3, 'The Witcher 3: Wild Hunt')).toBeVisible();
    await expect(page.locator('.ps-rec-prog')).toHaveCount(0);
  });
});

test.describe('Новое от ИИ: долгая загрузка', () => {
  test('первая загрузка: панель с этапом, подсказка, полоска, скелеты; затем карточки', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, st({ delayMs: 2000 }));
    const prog = page.locator('.ps-rec-prog');
    await expect(prog).toBeVisible();
    await expect(prog.getByText('Смотрю, что тебе заходило…')).toBeVisible();
    await expect(prog.getByText('Подбор делается один раз в сутки и сохраняется. Можно подождать или вернуться позже.')).toBeVisible();
    await expect(page.locator('.ps-rec--sk').first()).toBeVisible();
    await expect(refreshBtn(page)).toBeDisabled();
    await expect(prog).toHaveCount(0, { timeout: 5000 });
    await expect(card(page, 1, 3, 'The Witcher 3: Wild Hunt')).toBeVisible();
  });

  test('второй этап по времени', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, st({ delayMs: 5000 }));
    await expect(page.locator('.ps-rec-prog').getByText('Подбираю игры под твой вкус…')).toBeVisible({ timeout: 4500 });
  });

  test('клиентский таймаут 65 с: понятное сообщение и «Повторить»', async ({ page, context, baseURL }) => {
    await page.clock.install();
    const s = await open(page, context, baseURL as string, st({ hangFirst: true }));
    await expect.poll(() => s.calls.get.length).toBe(1);
    await page.clock.fastForward(66_000);
    await expect(page.getByRole('heading', { name: 'Не удалось загрузить подборку' })).toBeVisible();
    await expect(page.getByText('Подбор занял слишком много времени. Результат мог сохраниться: попробуй ещё раз.')).toBeVisible();
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(card(page, 1, 3, 'The Witcher 3: Wild Hunt')).toBeVisible();
  });
});

test.describe('Новое от ИИ: состояния', () => {
  const none = (m: Partial<Meta>) => st({ all: [], meta: meta(m) });

  test('пусто: всё отфильтровано, кнопка обновления', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, none({}));
    await expect(page.getByRole('heading', { name: 'Новых игр пока нет' })).toBeVisible();
    await expect(page.getByText('Все подобранные игры уже в твоей библиотеке, в плане или скрыты. Можно обновить подборку.')).toBeVisible();
    await page.getByRole('button', { name: 'Обновить подборку' }).click();
    await expect.poll(() => s.calls.get).toEqual(['plain', 'refresh=1']);
  });

  test('пусто: всё отфильтровано при refreshLeft = 0, без кнопки', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, none({ refreshLeft: 0 }));
    await expect(page.getByText('Обновить можно будет завтра.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Обновить подборку' })).toHaveCount(0);
  });

  test('пусто: не подтвердилось', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, none({ verified: 0 }));
    await expect(page.getByRole('heading', { name: 'Не удалось подобрать игры' })).toBeVisible();
    await expect(page.getByText('Предложенные игры не нашлись в каталоге PlayStation. Попробуй обновить подборку.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Обновить подборку' })).toBeVisible();
  });

  test('llm disabled: панель настройки без секретов, кнопка ведёт в бэклог', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, none({ llm: 'disabled' }));
    await expect(page.getByRole('heading', { name: 'Режим пока не настроен' })).toBeVisible();
    const text = await page.locator('.ps-rec-empty').innerText();
    expect(text).not.toMatch(/LLM_|RAWG_API|KEY|GROQ/i);
    await expect(refreshBtn(page)).toHaveCount(0);
    await page.locator('.ps-rec-empty').getByRole('button', { name: 'Из бэклога' }).click();
    await expect(page).toHaveURL(/\/recommend$/);
    await expect(page.getByText('Из 37 игр бэклога по твоей истории')).toBeVisible();
  });

  test('catalog unavailable: панель, «Повторить» без refresh', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, none({ catalog: 'unavailable', cached: false }));
    await expect(page.getByRole('heading', { name: 'Каталог игр недоступен' })).toBeVisible();
    await expect(page.getByText(/Ничего не показываю, чтобы не предлагать выдуманные названия/)).toBeVisible();
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect.poll(() => s.calls.get).toEqual(['plain', 'plain']);
  });

  test('приоритет: disabled важнее catalog unavailable', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, none({ llm: 'disabled', catalog: 'unavailable' }));
    await expect(page.getByRole('heading', { name: 'Режим пока не настроен' })).toBeVisible();
  });

  test('limit без карточек', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, none({ llm: 'limit' }));
    await expect(page.getByRole('heading', { name: 'На сегодня подборки закончились' })).toBeVisible();
    await expect(refreshBtn(page)).toHaveCount(0);
  });

  test('limit с карточками: заметка, кнопка выключена', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, st({ meta: meta({ llm: 'limit' }) }));
    await expect(card(page, 1, 3, 'The Witcher 3: Wild Hunt')).toBeVisible();
    await expect(page.getByText('Показана прежняя подборка: дневной лимит ИИ на сегодня исчерпан.')).toBeVisible();
    await expect(refreshBtn(page)).toBeDisabled();
    await expect(refreshBtn(page)).toHaveAttribute('title', 'Дневной лимит ИИ исчерпан');
  });

  test('error без карточек и с карточками', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, none({ llm: 'error' }));
    await expect(page.getByRole('heading', { name: 'Подборка пока недоступна' })).toBeVisible();
    await expect(page.getByText('ИИ сейчас не отвечает. Это временно, попробуй чуть позже.')).toBeVisible();
    await open(page, context, baseURL as string, st({ meta: meta({ llm: 'error' }) }));
    await expect(page.getByText('Новую подборку получить не удалось. Показана прежняя.')).toBeVisible();
    await expect(card(page, 1, 3, 'The Witcher 3: Wild Hunt')).toBeVisible();
  });

  test('503: панель с «Повторить», строки подборки нет', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, st({ fails: [503] }));
    await expect(page.getByRole('heading', { name: 'Подборка пока недоступна' })).toBeVisible();
    await expect(page.getByText('Не получилось обратиться к базе данных. Это временно.')).toBeVisible();
    await expect(refreshBtn(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(card(page, 1, 3, 'The Witcher 3: Wild Hunt')).toBeVisible();
    expect(s.calls.get).toEqual(['plain', 'plain']);
  });

  test('сеть при первой загрузке', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, st({ fails: ['abort'] }));
    await expect(page.getByRole('heading', { name: 'Не удалось загрузить подборку' })).toBeVisible();
    await expect(page.getByText('Проверь соединение и попробуй ещё раз.')).toBeVisible();
  });

  test('сбой обновления при наличии карточек: баннер, карточки остаются, действия работают', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string);
    await expect(card(page, 1, 3, 'The Witcher 3: Wild Hunt')).toBeVisible();
    s.fails.push(503);
    await refreshBtn(page).click();
    await expect(page.getByText('Не удалось обновить подборку. Показана прежняя.')).toBeVisible();
    await expect(card(page, 1, 3, 'The Witcher 3: Wild Hunt')).toBeVisible();
    await card(page, 1, 3, 'The Witcher 3: Wild Hunt').getByRole('button', { name: /^В план:/ }).click();
    await expect(page.getByText('Добавлено в план: «The Witcher 3: Wild Hunt»')).toBeVisible();
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByText('Не удалось обновить подборку. Показана прежняя.')).toBeHidden();
  });

  test('скрытые видны под панелью «Новых игр пока нет»', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, st({ all: [dItem('1', 'Игра А')] }));
    await card(page, 1, 1, 'Игра А').getByRole('button', { name: /^Не интересно:/ }).click();
    await expect(page.getByRole('heading', { name: 'Новых игр пока нет' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Скрытые на сейчас · 1/ })).toBeVisible();
    expect(s.calls.hide).toHaveLength(1);
  });
});

test.describe('Новое от ИИ: адаптивность', () => {
  for (const [w, h] of [[1280, 900], [1024, 800], [768, 900], [360, 740], [320, 640]] as const) {
    test(`без горизонтального скролла на ${w}`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width: w, height: h });
      await open(page, context, baseURL as string, st({ all: [dItem('1', 'Очень длинное название игры которое должно переноситься и не ломать раскладку карточки на узком экране', { planned: true })] }));
      await expect(page.getByRole('listitem', { name: /Новая игра 1 из 1/ })).toBeVisible();
      expect(await noHScroll(page)).toBe(true);
      await page.getByRole('button', { name: /Не интересно:/ }).click();
      await expect(page.getByRole('button', { name: /Скрытые на сейчас · 1/ })).toBeVisible();
      await page.getByRole('button', { name: /Скрытые на сейчас · 1/ }).click();
      expect(await noHScroll(page)).toBe(true);
    });
  }
});
