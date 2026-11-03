// Фаза 21: интерактивный тур (design-system §10, контракт §23). API эмулируется (collection-mock.ts + /api/me/tour).
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

type TourMock = {
  /** текущее состояние на «сервере» */
  completedVersion: number;
  shouldAutoStart: boolean;
  /** статусы ответов: GET / PUT */
  getStatus: number;
  putStatus: number;
  puts: unknown[];
  gets: number;
};

const stats503 = (r: Route) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'db_unavailable', message: 'x' } }) });

async function open(
  page: Page, context: BrowserContext, baseURL: string,
  o: { games?: ReturnType<typeof seed>; tour?: Partial<TourMock>; url?: string } = {},
): Promise<TourMock> {
  const t: TourMock = { completedVersion: 0, shouldAutoStart: false, getStatus: 200, putStatus: 200, puts: [], gets: 0, ...o.tour };
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, o.games ?? seed());
  await page.route(/\/api\/stats(\?|$)/, stats503);
  await page.route('**/api/me/tour', async (r) => {
    const data = () => ({ ok: true, data: { version: 1, completedVersion: t.completedVersion, shouldAutoStart: t.shouldAutoStart } });
    if (r.request().method() === 'GET') {
      t.gets++;
      if (t.getStatus !== 200) return r.fulfill({ status: t.getStatus, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'db_unavailable', message: 'x' } }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data()) });
    }
    t.puts.push(r.request().postDataJSON());
    if (t.putStatus !== 200) return r.fulfill({ status: t.putStatus, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'db_unavailable', message: 'x' } }) });
    t.completedVersion = 1;
    t.shouldAutoStart = false;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data()) });
  });
  await page.goto(o.url ?? '/');
  await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
  return t;
}

const dialog = (page: Page) => page.getByRole('dialog', { name: /./ }).filter({ has: page.getByTestId('tour-count') });
const count = (page: Page) => page.getByTestId('tour-count');
const next = (page: Page) => dialog(page).getByRole('button', { name: 'Далее' });
const back = (page: Page) => dialog(page).getByRole('button', { name: 'Назад' });
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

/** Запуск из меню профиля (десктоп) или меню «⋯» (мобильный) */
async function startFromMenu(page: Page) {
  if (isMobile(page)) {
    await page.getByRole('button', { name: 'Меню', exact: true }).click();
    await page.getByRole('button', { name: 'Как пользоваться' }).click();
  } else {
    await page.locator('.ps-avatar').click();
    await page.getByRole('menuitem', { name: 'Как пользоваться' }).click();
  }
  await expect(count(page)).toHaveText('1 из 14');
}

type Rect = { x: number; y: number; w: number; h: number };
async function rects(page: Page, anchor: string | null): Promise<{ spot: Rect | null; target: Rect | null; pop: Rect }> {
  return page.evaluate((id) => {
    const r = (el: Element | null): Rect | null => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height };
    };
    const vis = id ? Array.from(document.querySelectorAll(`[data-tour="${id}"]`)).find((e) => e.getBoundingClientRect().width > 0) ?? null : null;
    return { spot: r(document.querySelector('.ps-tour__spot')), target: r(vis), pop: r(document.querySelector('.ps-tour__pop'))! };
  }, anchor);
}
const same = (a: Rect | null, b: Rect | null) => !!a && !!b && [a.x - b.x, a.y - b.y, a.w - b.w, a.h - b.h].every((d) => Math.abs(d) < 0.6);

/** Ждёт, пока прожектор перестанет двигаться (перелёт, прокрутка) */
async function settled(page: Page, anchor: string | null) {
  let prev: Rect | null = null;
  await expect.poll(async () => {
    const cur = (await rects(page, anchor)).spot;
    const ok = same(cur, prev);
    prev = cur;
    return ok;
  }, { timeout: 5000, intervals: [150] }).toBe(true);
}

const ANCHORS_DESKTOP = ['nav', 'game-card', 'card-status', 'search', 'filters', null, 'triage-actions', 'backlog-list', 'backlog-subnav', 'stats-period', 'stats-wrapped', 'sync', 'theme', null];
const ANCHORS_MOBILE = ['nav', 'game-card', 'game-card', 'search-hdr', 'filters-btn', null, 'triage-buttons', 'backlog-list', 'backlog-subnav', 'stats-period', 'stats-wrapped', 'menu-more', 'menu-more', null];
const PATHS = ['/', '/', '/', '/', '/', '/', '/triage', '/backlog', '/backlog', '/stats', '/stats'];

test.describe('тур: полный проход', () => {
  test('14 шагов вперёд и назад, прожектор на нужном элементе, готово ставит done', async ({ page, context, baseURL }) => {
    test.setTimeout(120_000);
    const t = await open(page, context, baseURL!);
    const anchors = isMobile(page) ? ANCHORS_MOBILE : ANCHORS_DESKTOP;
    await startFromMenu(page);
    await expect(dialog(page)).toBeFocused();
    await expect(back(page)).toHaveCount(0); // на шаге 1 «Назад» нет
    expect(t.puts).toHaveLength(0); // запуск из меню статус не меняет

    for (let i = 0; i < 14; i++) {
      await expect(count(page)).toHaveText(`${i + 1} из 14`);
      const a = anchors[i];
      if (i < 13) await expect(next(page)).toBeEnabled();
      await expect(page.locator('.ps-tour__bar > i')).toHaveCSS('width', /./);
      if (a === null) {
        await expect(page.locator('.ps-tour')).toHaveAttribute('data-mode', 'center');
        await expect(page.locator('.ps-tour__spot')).toHaveCount(0);
      } else {
        await expect(page.locator('.ps-tour')).toHaveAttribute('data-mode', 'spot');
        await settled(page, a);
        const { spot, target, pop } = await rects(page, a);
        expect(target, `якорь ${a}`).not.toBeNull();
        // кольцо охватывает элемент (с учётом обрезки по экрану и расширения мелких элементов)
        const tx = Math.max(target!.x, 0);
        let ty = Math.max(target!.y, 0);
        if (isMobile(page) && target!.y >= pop.y) ty = Math.max(ty, pop.y + pop.h); // кольцо нижнего меню начинается у кромки листа
        const tr = Math.min(target!.x + target!.w, page.viewportSize()!.width), tb = Math.min(target!.y + target!.h, isMobile(page) && target!.y < pop.y ? pop.y : page.viewportSize()!.height); // на мобильном рамка кончается у листа
        expect(spot!.x).toBeLessThanOrEqual(tx + 3);
        expect(spot!.y).toBeLessThanOrEqual(ty + 3);
        expect(spot!.x + spot!.w).toBeGreaterThanOrEqual(tr - 3);
        expect(spot!.y + spot!.h).toBeGreaterThanOrEqual(tb - 3);
        // поповер не перекрывает кольцо (кроме огромного списка бэклога на десктопе: у него нет свободной стороны)
        if (!(a === 'backlog-list' && !isMobile(page))) {
          const e = 1.5; // допуск на дробные пиксели (лист стоит вплотную к нижнему меню)
          const overlap = pop.x < spot!.x + spot!.w - e && pop.x + pop.w > spot!.x + e && pop.y < spot!.y + spot!.h - e && pop.y + pop.h > spot!.y + e;
          expect(overlap, `поповер перекрывает кольцо ${a}`).toBe(false);
        }
      }
      if (i < 11) expect(new URL(page.url()).pathname).toBe(PATHS[i]);
      if (i < 13) { await next(page).click(); }
    }

    // последний шаг: кнопки, нет «Пропустить» и «Далее»
    await expect(dialog(page).getByRole('button', { name: 'Готово' })).toBeFocused();
    await expect(dialog(page).getByRole('button', { name: 'Пропустить тур' })).toHaveCount(0);
    await expect(next(page)).toHaveCount(0);
    await expect(dialog(page).getByRole('button', { name: 'Открыть Разбор' })).toBeVisible();

    // назад по всем шагам, включая смену страниц
    for (let i = 13; i > 0; i--) {
      await back(page).click();
      await expect(count(page)).toHaveText(`${i} из 14`);
      if (i - 1 < 11) await expect.poll(() => new URL(page.url()).pathname).toBe(PATHS[i - 1]);
    }
    await expect(back(page)).toHaveCount(0);

    for (let i = 0; i < 13; i++) await next(page).click();
    await dialog(page).getByRole('button', { name: 'Готово' }).click();
    await expect(page.locator('.ps-tour')).toHaveCount(0);
    expect(t.puts).toEqual([{ done: true, version: 1 }]);
    // фон снова доступен, фокус на заголовке страницы
    await expect(page.locator('main.ps-main')).not.toHaveAttribute('inert', /.*/);
    await expect(page.locator('h1').first()).toBeFocused();
  });

  test('«Открыть Разбор» на последнем шаге закрывает тур и ведёт на /triage', async ({ page, context, baseURL }) => {
    const t = await open(page, context, baseURL!);
    await startFromMenu(page);
    for (let i = 0; i < 13; i++) await next(page).click();
    await expect(count(page)).toHaveText('14 из 14');
    await dialog(page).getByRole('button', { name: 'Открыть Разбор' }).click();
    await page.waitForURL('**/triage');
    await expect(page.locator('.ps-tour')).toHaveCount(0);
    expect(t.puts).toEqual([{ done: true, version: 1 }]);
  });
});

test.describe('тур: состояния', () => {
  test('пустой аккаунт: шаги 2, 3, 7, 8 показывают заметку, тур проходится до конца', async ({ page, context, baseURL }) => {
    test.setTimeout(120_000);
    await open(page, context, baseURL!, { games: [] });
    await startFromMenu(page);
    const noteSteps = new Map<number, RegExp>([
      [2, /Игр пока нет/], [3, /Когда в Коллекции появятся игры/], [7, /Всё разобрано/], [8, /Бэклог пуст/],
    ]);
    for (let i = 1; i <= 14; i++) {
      await expect(count(page)).toHaveText(`${i} из 14`);
      const re = noteSteps.get(i);
      if (re) {
        await expect(page.getByTestId('tour-note')).toHaveText(re, { timeout: 6000 });
        await expect(page.locator('.ps-tour')).toHaveAttribute('data-mode', 'center');
        await expect(next(page)).not.toHaveAttribute('aria-disabled', 'true');
      }
      if (i < 14) await next(page).click();
    }
    await dialog(page).getByRole('button', { name: 'Готово' }).click();
    await expect(page.locator('.ps-tour')).toHaveCount(0);
  });

  test('Esc закрывает сразу, страница остаётся, горячие клавиши не срабатывают, PUT ушёл', async ({ page, context, baseURL }) => {
    const t = await open(page, context, baseURL!);
    await startFromMenu(page);
    await next(page).click();
    await expect(count(page)).toHaveText('2 из 14');
    // «/» не ставит курсор в поиск, пока тур открыт
    await page.keyboard.press('/');
    await expect(page.locator('input[type=search]:focus')).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(count(page)).toHaveText('3 из 14');
    await page.keyboard.press('ArrowLeft');
    await expect(count(page)).toHaveText('2 из 14');
    await page.keyboard.press('Escape');
    await expect(page.locator('.ps-tour')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/');
    expect(t.puts).toEqual([{ done: true, version: 1 }]);
    await expect(page.locator('h1').first()).toBeFocused();
  });

  test('Esc в Разборе закрывает тур, а не уводит на коллекцию', async ({ page, context, baseURL }) => {
    test.skip(isMobile(page), 'клавиатурный сценарий');
    await open(page, context, baseURL!);
    await page.goto('/triage');
    await expect(page.getByRole('heading', { level: 2, name: 'Tetris Effect' })).toBeVisible();
    await startFromMenu(page);
    for (let i = 0; i < 6; i++) await next(page).click();
    await expect(count(page)).toHaveText('7 из 14');
    await expect(page.locator('.ps-tour')).toHaveAttribute('data-mode', 'spot');
    await page.keyboard.press('Escape');
    await expect(page.locator('.ps-tour')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/triage');
  });

  test('«Пропустить» закрывает без подтверждения; Tab не выходит из поповера', async ({ page, context, baseURL }) => {
    test.skip(isMobile(page), 'клавиатурный сценарий');
    const t = await open(page, context, baseURL!);
    await startFromMenu(page);
    await next(page).click();
    await expect(count(page)).toHaveText('2 из 14');
    const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('.ps-tour__pop'));
    for (let i = 0; i < 7; i++) { await page.keyboard.press('Tab'); expect(await inDialog()).toBe(true); }
    for (let i = 0; i < 7; i++) { await page.keyboard.press('Shift+Tab'); expect(await inDialog()).toBe(true); }
    await dialog(page).getByRole('button', { name: 'Пропустить тур' }).click();
    await expect(page.locator('.ps-tour')).toHaveCount(0);
    expect(t.puts).toHaveLength(1);
  });

  test('aria: диалог, подпись, описание, фон inert, live-регион объявляет шаг', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await startFromMenu(page);
    const d = dialog(page);
    await expect(d).toHaveAttribute('aria-modal', 'true');
    await expect(d).toHaveAttribute('aria-labelledby', /./);
    await expect(d).toHaveAttribute('aria-describedby', /./);
    await expect(page.locator('main.ps-main')).toHaveAttribute('inert', '');
    await expect(page.locator('header.ps-header')).toHaveAttribute('inert', '');
    await next(page).click();
    await expect(page.locator('.ps-tour [role="status"]')).toHaveText(/^Шаг 2 из 14\. Карточка игры\./);
  });

  test('повтор из меню после завершения запускает тур снова', async ({ page, context, baseURL }) => {
    const t = await open(page, context, baseURL!, { tour: { completedVersion: 1 } });
    await startFromMenu(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.ps-tour')).toHaveCount(0);
    await startFromMenu(page);
    await expect(count(page)).toHaveText('1 из 14');
    expect(t.puts.length).toBeGreaterThan(0);
  });

  test('кнопка «назад» браузера во время тура закрывает его', async ({ page, context, baseURL }) => {
    const t = await open(page, context, baseURL!);
    await startFromMenu(page);
    for (let i = 0; i < 6; i++) await next(page).click(); // шаг 7: /triage
    await expect(count(page)).toHaveText('7 из 14');
    await page.waitForURL('**/triage');
    await page.goBack();
    await expect(page.locator('.ps-tour')).toHaveCount(0);
    expect(t.puts).toHaveLength(1);
  });

  test('перезагрузка во время тура возобновляет текущий шаг', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await startFromMenu(page);
    for (let i = 0; i < 3; i++) await next(page).click();
    await expect(count(page)).toHaveText('4 из 14');
    await page.reload();
    await expect(count(page)).toHaveText('4 из 14');
    await expect(dialog(page).getByRole('heading', { name: 'Поиск' })).toBeVisible();
  });

  test('медленная страница: «Открываем раздел», Далее неактивна, затем подсветка без перезапуска', async ({ page, context, baseURL }) => {
    const mock = await (async () => {
      await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
      return mockApi(page, seed());
    })();
    mock.delayList = (u) => (u.searchParams.get('status') === 'none' ? 1200 : 0);
    await page.route(/\/api\/stats(\?|$)/, stats503);
    await page.route('**/api/me/tour', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 1, shouldAutoStart: false } }) }));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
    await startFromMenu(page);
    for (let i = 0; i < 6; i++) await next(page).click();
    await expect(count(page)).toHaveText('7 из 14');
    await expect(page.getByTestId('tour-loading')).toHaveText('Открываем раздел «Разбор»…');
    await expect(next(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(back(page)).toBeEnabled();
    await expect(page.locator('.ps-tour')).toHaveAttribute('data-mode', 'spot', { timeout: 6000 });
    await expect(count(page)).toHaveText('7 из 14');
  });
});

test.describe('тур: автозапуск и ошибки API', () => {
  test('автозапуск при shouldAutoStart, один раз за сессию, после пропуска не повторяется', async ({ page, context, baseURL }) => {
    const t = await open(page, context, baseURL!, { tour: { shouldAutoStart: true } });
    await expect(count(page)).toHaveText('1 из 14', { timeout: 8000 });
    expect(t.gets).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.ps-tour')).toHaveCount(0);
    expect(t.puts).toEqual([{ done: true, version: 1 }]);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
    await page.waitForTimeout(1800);
    await expect(page.locator('.ps-tour')).toHaveCount(0);
  });

  test('shouldAutoStart=false: тур не стартует', async ({ page, context, baseURL }) => {
    const t = await open(page, context, baseURL!, { tour: { shouldAutoStart: false, completedVersion: 1 } });
    await page.waitForTimeout(1800);
    await expect(page.locator('.ps-tour')).toHaveCount(0);
    expect(t.gets).toBeGreaterThan(0);
  });

  test('автозапуск не стартует при открытом окне игры (?game=)', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { tour: { shouldAutoStart: true }, url: '/?game=1' });
    await page.waitForTimeout(1800);
    await expect(page.locator('.ps-tour')).toHaveCount(0);
  });

  test('fail-open: GET /api/me/tour отвечает 500 -> тур не стартует, сайт работает', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { tour: { shouldAutoStart: true, getStatus: 500 } });
    await page.waitForTimeout(1800);
    await expect(page.locator('.ps-tour')).toHaveCount(0);
    await expect(page.locator('.ps-card').first()).toBeVisible();
    // ручной запуск при этом работает
    await startFromMenu(page);
  });

  test('fail-open: сетевая ошибка GET -> тур не стартует', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    await mockApi(page, seed());
    await page.route('**/api/me/tour', (r) => r.abort('failed'));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.locator('.ps-tour')).toHaveCount(0);
  });

  test('ошибка PUT не ломает UI: тур закрывается, запасной флаг не даёт автозапуску повториться', async ({ page, context, baseURL }) => {
    const t = await open(page, context, baseURL!, { tour: { shouldAutoStart: true, putStatus: 500 } });
    await expect(count(page)).toHaveText('1 из 14', { timeout: 8000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.ps-tour')).toHaveCount(0);
    await expect.poll(() => t.puts.length).toBe(1);
    await expect(page.getByRole('heading', { level: 1, name: 'Коллекция' })).toBeVisible();
    // флаг пишется после ответа 500 на PUT, а t.puts растёт уже при перехвате запроса: ждём, а не читаем сразу
    await expect.poll(() => page.evaluate(() => localStorage.getItem('ps-tour-seen'))).toBe('1');
    // новая сессия (sessionStorage очищен), сервер всё ещё просит автозапуск: локальный флаг останавливает
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.waitForTimeout(1800);
    await expect(page.locator('.ps-tour')).toHaveCount(0);
  });
});

test.describe('тур: мобильный лист', () => {
  test.beforeEach(({ page }) => { test.skip(!isMobile(page), 'только мобильный'); });

  test('лист над нижним меню, шаги 12–13 подсвечивают «⋯» и не открывают меню', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await startFromMenu(page);
    await settled(page, 'nav');
    const tab = await page.evaluate(() => document.querySelector('.ps-tabbar')!.getBoundingClientRect().top);
    const pop = (await rects(page, 'nav')).pop;
    expect(pop.y + pop.h).toBeLessThanOrEqual(tab + 1);
    expect(pop.x).toBe(0);
    for (let i = 0; i < 11; i++) await next(page).click();
    await expect(count(page)).toHaveText('12 из 14');
    await settled(page, 'menu-more');
    await expect(page.getByRole('dialog', { name: 'Меню' })).toHaveCount(0);
    await expect(dialog(page)).toContainText('меню «⋯»');
    await next(page).click();
    await expect(count(page)).toHaveText('13 из 14');
    // кнопки листа не меньше 44 px
    const h = await next(page).evaluate((el) => el.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(44);
  });

  test('мобильный лист: шаг 3 говорит про долгое нажатие', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await startFromMenu(page);
    await next(page).click();
    await next(page).click();
    await expect(dialog(page)).toContainText('Удерживайте карточку');
  });
});

test.describe('тур: онбординг', () => {
  test('«Начать тур» на экране «готово» открывает / и стартует тур с шага 1', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    await mockApi(page, seed());
    const okJson = (r: Route, data: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
    let psn = { onlineId: 'Artem', accessMode: 'public', accessStatus: 'ok', checkedAt: '2026-10-31T09:00:00.000Z', canStartSync: true, onboardedAt: null as string | null, sync: null };
    const run = (status: string) => ({
      running: status === 'running', lastSuccessAt: null, psnAuth: 'ok', psnAuthExpiresAt: null, totals: null,
      run: { id: 5, kind: 'manual', status, phase: 'games', errorReason: null, errorMessage: null, startedAt: '2026-10-31T10:00:00.000Z', finishedAt: status === 'success' ? '2026-10-31T10:05:00.000Z' : null, snapshotDate: null, progress: { phase: 'games', step: 4, steps: 4, done: null, total: null }, counters: { gamesSeen: 10 } },
    });
    let started = false;
    await page.route('**/api/me/psn', (r) => okJson(r, psn));
    await page.route('**/api/sync', (r) => { started = true; return okJson(r, { started: true, resumed: false, run: { id: 5, kind: 'manual', status: 'running', phase: 'games' } }, 202); });
    await page.route('**/api/sync/status', (r) => {
      if (!started) return okJson(r, { running: false, run: null, lastSuccessAt: null, psnAuth: 'unknown', psnAuthExpiresAt: null, totals: null });
      psn = { ...psn, onboardedAt: '2026-10-31T10:05:00.000Z' };
      return okJson(r, run('success'));
    });
    await page.route(/\/api\/stats(\?|$)/, stats503);
    await page.route('**/api/me/tour', (r) => okJson(r, { version: 1, completedVersion: 0, shouldAutoStart: false }));
    await page.goto('/onboarding');
    await expect(page.getByTestId('ob-done')).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Пропустить, открыть Разбор' })).toBeVisible();
    await page.getByRole('button', { name: 'Начать тур' }).click();
    await page.waitForURL((u) => u.pathname === '/');
    await expect(count(page)).toHaveText('1 из 14');
  });
});
