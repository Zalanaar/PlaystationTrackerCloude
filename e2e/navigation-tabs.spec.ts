// Фаза 18 (UX): навигация 4 вкладки, подвкладки, чипы месяцев, мобильный первый экран, `?game=`, скелеты без скачков, Итоги года, 404.
// Формы ответов по контрактам §9/§10/§17, не по реализации.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G, type Mock } from './collection-mock';
import { baseState, mockRoadmap } from './roadmap-mock';
import { signedSession } from './session';

const THIS_YEAR = new Date(Date.now() + 3 * 3600_000).getUTCFullYear();
const ok = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
const z = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };

async function setup(page: Page, context: BrowserContext, baseURL: string, games?: G[]): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  return mockApi(page, games);
}

function statsBody() {
  const mk = (id: number, month: number) => ({
    id, title: `Игра ${id}`, coverUrl: null, platform: 'PS5', playSeconds: 36000, hours: 10, playCount: 3, lastPlayedAt: `${THIS_YEAR}-${String(month).padStart(2, '0')}-10T10:00:00.000Z`,
    status: 'completed', completedAt: `${THIS_YEAR}-${String(month).padStart(2, '0')}-10T10:00:00.000Z`, droppedAt: null, trophies: null, genres: [{ key: 'ACTION', label: 'Экшен' }],
  });
  const g1 = mk(1, 3); const g2 = mk(2, 5); const g3 = mk(3, 5);
  const grp = (month: number, ids: number[]) => ({
    month: `${THIS_YEAR}-${String(month).padStart(2, '0')}`, year: THIS_YEAR, monthNumber: month, completed: ids.length, dropped: 0,
    items: ids.map((gameId) => ({ gameId, hours: 5, estimated: false, finished: 'completed', finishedAt: `${THIS_YEAR}-${String(month).padStart(2, '0')}-10T10:00:00.000Z` })),
  });
  return {
    period: { type: 'year', year: THIS_YEAR, month: null, from: `${THIS_YEAR}-01-01`, to: `${THIS_YEAR}-12-31`, fromUtc: `${THIS_YEAR - 1}-12-31T21:00:00.000Z`, toUtc: `${THIS_YEAR}-12-31T21:00:00.000Z` },
    years: [THIS_YEAR], header: { completed: 3, dropped: 0, hours: 50, platinum: 0 },
    hours: { byMonth: Array(12).fill(null).map((_, i) => (i < 5 ? 10 : null)), estimatedByMonth: Array(12).fill(0), estimatedHours: 0, hasEstimate: false, firstSnapshotDate: `${THIS_YEAR}-01-15`, periodPartial: false },
    genres: { hasData: true, items: [{ key: 'ACTION', label: 'Экшен', value: 3, gameIds: [1] }], games: { 1: { id: 1, title: 'Игра 1', coverUrl: null } } },
    top: { byHours: [{ game: g1, hours: 12.5, estimated: false }], byTrophies: [] },
    rareTrophies: { period: [], allTime: [] },
    trophies: { counts: { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 }, byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...z })) },
    finished: { groups: [] },
    played: { games: { 1: g1, 2: g2, 3: g3 }, groups: [grp(3, [1]), grp(5, [2, 3])] },
  };
}

async function mockStats(page: Page, delay = 0) {
  await page.route(/\/api\/stats(\?|$)/, async (r) => {
    if (delay) await new Promise((res) => setTimeout(res, delay));
    await r.fulfill(ok(statsBody()));
  });
}

// Dev-сервер подгружает CSS кусками, поэтому шаги до события load (FOUC) не считаем: в проде стили блокируют первую отрисовку.
async function trackCls(page: Page) {
  await page.addInitScript(() => {
    type LS = PerformanceEntry & { value: number; hadRecentInput: boolean };
    const w = window as unknown as { __ls: { t: number; v: number; n: string }[] };
    w.__ls = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries() as LS[]) if (!e.hadRecentInput) w.__ls.push({ t: Math.round(e.startTime), v: e.value, n: ((e as unknown as { sources?: { node?: Element }[] }).sources ?? []).map((x) => (x.node as HTMLElement | undefined)?.className?.toString().slice(0, 30) ?? '').join('|') }); }).observe({ type: 'layout-shift', buffered: true });
  });
}
/** Скелет уже виден и стили догружены: дальше считаем только скачки при подмене скелета данными. */
const resetCls = async (page: Page) => {
  await page.locator('.ps-skeleton').first().waitFor();
  await page.waitForTimeout(500);
  // Полоса «С прошлого визита»: её скелет больше не схлопывается (п. B, без сдвига — проверка в inbox-layout-edge.spec.ts).
  // Ждём конец её загрузки, чтобы замер касался только подмены скелетов экрана данными.
  await expect(page.getByTestId('inbox-skeleton')).toHaveCount(0, { timeout: 10_000 });
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
  await page.evaluate(() => { (window as unknown as { __ls: unknown[] }).__ls.length = 0; });
};
const cls = (page: Page) => page.evaluate(() => {
  const from = 0;
  const late = (window as unknown as { __ls: { t: number; v: number; n: string }[] }).__ls.filter((e) => e.t >= from);
  (window as unknown as { __lsDebug: string }).__lsDebug = JSON.stringify(late);
  return late.reduce((s, e) => s + e.v, 0);
});

test.describe('Навигация: 4 вкладки и подвкладки (18.3)', () => {
  test('десктоп-шапка: ровно 4 вкладки, группы подсвечены по путям', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name === 'mobile', 'шапка с вкладками только на десктопе');
    await setup(page, context, baseURL!);
    await page.goto('/');
    const tabs = page.locator('header nav[aria-label="Разделы"] a');
    await expect(tabs).toHaveText(['Коллекция', 'Бэклог', 'Статистика', 'Разбор']);
    await expect(tabs.nth(0)).toHaveAttribute('aria-current', 'page');
    const cur = async (path: string, tab: string, sub?: string) => {
      await page.goto(path);
      await expect(page.locator('header nav[aria-label="Разделы"] a[aria-current="page"]')).toHaveText(tab);
      if (sub) await expect(page.locator('nav[aria-label="Раздел бэклога"] a[aria-current="page"]')).toHaveText(sub);
    };
    await cur('/backlog', 'Бэклог', 'Бэклог');
    await cur('/roadmap', 'Бэклог', 'План');
    await cur('/recommend', 'Бэклог', 'Подскажи');
    await cur('/stats', 'Статистика');
    await cur('/wrapped', 'Статистика');
    await cur('/triage', 'Разбор');
    await expect(page.locator('nav[aria-label="Раздел бэклога"]')).toHaveCount(0);
  });

  test('меню профиля без «Разобрать игры», вкладка «Разбор» открывает /triage', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name === 'mobile', 'меню профиля на десктопе');
    await setup(page, context, baseURL!);
    await page.goto('/');
    await page.getByRole('button', { name: /Профиль|Меню профиля/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Скрытые игры' })).toBeVisible();
    await expect(page.getByText('Разобрать игры')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.locator('header nav[aria-label="Разделы"]').getByRole('link', { name: 'Разбор' }).click();
    await expect(page).toHaveURL(/\/triage/);
  });

  test('768 px: шапка не переполняется', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name === 'mobile', 'размер задаётся вручную');
    await setup(page, context, baseURL!);
    for (const w of [768, 860, 905, 1023]) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto('/');
      const o = await page.evaluate(() => {
        const h = document.querySelector('.ps-header__in') as HTMLElement;
        return { inner: h.scrollWidth - h.clientWidth, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      expect(o.inner, `шапка ${w}`).toBeLessThanOrEqual(0);
      expect(o.doc, `страница ${w}`).toBeLessThanOrEqual(0);
    }
  });

  test('мобильный tab bar: 4 равные ячейки, подпись «Статистика» целиком', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'mobile', 'tab bar только на мобильном');
    await setup(page, context, baseURL!);
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/');
    const tabs = page.locator('nav.ps-tabbar a');
    await expect(tabs).toHaveText(['Коллекция', 'Бэклог', 'Статистика', 'Разбор']);
    const boxes = await tabs.evaluateAll((els) => els.map((e) => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, over: (e.querySelector('span:last-child') as HTMLElement).scrollWidth > e.clientWidth })));
    for (const b of boxes) { expect(Math.abs(b.w - 90)).toBeLessThan(1); expect(b.h).toBeGreaterThanOrEqual(44); expect(b.over).toBe(false); }
    await page.goto('/roadmap');
    await expect(tabs.nth(1)).toHaveAttribute('aria-current', 'page');
    const sub = page.locator('nav[aria-label="Раздел бэклога"] a');
    const sb = await sub.evaluateAll((els) => els.map((e) => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })));
    expect(sb).toHaveLength(3);
    for (const b of sb) { expect(b.h).toBe(44); expect(Math.abs(b.w - (360 - 32) / 3)).toBeLessThan(2); }
  });

  test('подвкладки не мигают: видны сразу при медленном API', async ({ page, context, baseURL }) => {
    const m = await setup(page, context, baseURL!);
    m.delayList = () => 1500;
    await page.goto('/backlog');
    await expect(page.locator('nav[aria-label="Раздел бэклога"] a')).toHaveCount(3);
  });
});

test.describe('Итоги года: кнопка, баннер, точка (18.3)', () => {
  test('вне сезона: баннера и точки нет, кнопка «Итоги» есть; на /wrapped ссылка «Статистика»', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await mockStats(page);
    await page.goto('/stats');
    await expect(page.getByRole('link', { name: `Итоги ${THIS_YEAR}` })).toBeVisible();
    await expect(page.locator('.ps-wbanner')).toHaveCount(0);
    await expect(page.locator('.ps-notify-dot')).toHaveCount(0);
    await page.getByRole('link', { name: `Итоги ${THIS_YEAR}` }).click();
    await expect(page).toHaveURL(/\/wrapped/);
    await page.getByRole('link', { name: 'Статистика', exact: true }).filter({ hasText: /^Статистика$/ }).first().click();
  });

  test('декабрь: баннер и точка видны, ✕ запоминается по году', async ({ page, context, baseURL }, info) => {
    await setup(page, context, baseURL!);
    await mockStats(page);
    await page.clock.setFixedTime(new Date(`${THIS_YEAR}-12-15T09:00:00Z`));
    await page.goto('/stats');
    const banner = page.locator('.ps-wbanner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(`Итоги ${THIS_YEAR} готовы`);
    const tabSel = info.project.name === 'mobile' ? 'nav.ps-tabbar a' : 'header nav[aria-label="Разделы"] a';
    await expect(page.locator(tabSel).filter({ hasText: 'Статистика' }).locator('.ps-notify-dot')).toBeVisible();
    await expect(page.locator(tabSel).filter({ hasText: 'Статистика' })).toHaveAttribute('aria-label', 'Статистика, доступны Итоги года');
    await banner.getByRole('button', { name: 'Скрыть' }).click();
    await expect(banner).toHaveCount(0);
    await expect(page.getByRole('link', { name: `Итоги ${THIS_YEAR}` })).toBeVisible();
    await page.reload();
    await expect(page.locator('.ps-wbanner')).toHaveCount(0);
    expect(await page.evaluate((y) => localStorage.getItem(`ps-wbanner-hidden-${y}`), THIS_YEAR)).toBe('1');
  });

  test('январь: баннер про прошлый год; открытие /wrapped гасит его и точку', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await page.route(/\/api\/stats(\?|$)/, (r) => r.fulfill(ok({ ...statsBody(), years: [THIS_YEAR - 1, THIS_YEAR] })));
    await page.clock.setFixedTime(new Date(`${THIS_YEAR + 1}-01-10T09:00:00Z`));
    await page.goto('/stats');
    await expect(page.locator('.ps-wbanner')).toContainText(`Итоги ${THIS_YEAR} готовы`);
    await page.goto('/wrapped');
    await expect(page.getByRole('heading', { name: 'Итоги', level: 1 })).toBeVisible();
    await page.goto('/stats');
    await expect(page.locator('.ps-wbanner')).toHaveCount(0);
    await expect(page.locator('.ps-notify-dot')).toHaveCount(0);
  });
});

test.describe('Длинные страницы (18.1)', () => {
  test('Хроника: год одной сеткой без заголовков месяцев, чипы скроллят к первой карточке месяца', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '2026', level: 2 })).toBeVisible();
    await expect(page.locator('.ps-chron .ps-month')).toHaveCount(0);
    const chips = page.getByRole('navigation', { name: 'Месяцы 2026' });
    await expect(chips).toBeVisible();
    const buttons = chips.getByRole('button');
    await expect(buttons).toHaveCount(2);
    await expect(buttons.nth(0)).toHaveAttribute('aria-label', /^Фев 1 — Февраль: 1 пройдено$/);
    await expect(buttons.nth(1)).toHaveAttribute('aria-label', /^Янв 1 — Январь: 1 брошено$/);
    await buttons.nth(1).click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('m2026-01');
    await expect(buttons.nth(1)).toHaveAttribute('aria-current', 'true');
    // sticky: полоса под шапкой
    const top = await chips.evaluate((e) => e.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(0);
  });

  test('год с одним месяцем и «Без даты» без чипов', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await page.goto('/');
    await page.getByRole('button', { name: /^2024/ }).click();
    await expect(page.locator('#y2024-body')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Месяцы 2024' })).toHaveCount(0);
  });

  test('План: «Не успеваю» свёрнут до 5, «Показать все N» раскрывает и сворачивает', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    const games = Array.from({ length: 9 }, (_, i) => ({ id: 20 + i, title: `Длинная ${i + 1}`, hours: 400 }));
    await mockRoadmap(page, baseState({ hoursPerWeek: 0.5, games, order: games.map((g) => g.id) }));
    await page.goto('/roadmap');
    const over = page.locator('#rm-over');
    await expect(over).toBeVisible();
    const items = over.getByTestId('rm-over-item');
    const n = await over.locator('.ps-rm-cnt').innerText();
    const total = Number(n);
    expect(total).toBeGreaterThan(5);
    await expect(items).toHaveCount(5);
    const btn = over.getByRole('button', { name: `Показать все ${total}` });
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect(items).toHaveCount(total);
    await expect(over.getByRole('button', { name: 'Свернуть' })).toHaveAttribute('aria-expanded', 'true');
    await over.getByRole('button', { name: 'Свернуть' }).click();
    await expect(items).toHaveCount(5);
  });

  test('Статистика: «Игры месяца» только один месяц, ?m= восстанавливает выбор', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await mockStats(page);
    await page.goto('/stats');
    const sec = page.locator('#st-played-sec');
    await expect(sec.locator('.ps-month')).toHaveCount(1);
    await expect(sec.locator('.ps-month')).toContainText('Май');
    const chips = sec.getByRole('button', { pressed: true });
    await expect(chips).toHaveCount(1);
    await sec.getByRole('button', { name: /— Март/ }).click();
    await expect(page).toHaveURL(/[?&]m=\d{4}-03/);
    await expect(sec.locator('.ps-month')).toContainText('Март');
    await page.reload();
    await expect(sec.locator('.ps-month')).toContainText('Март');
    await expect(sec.locator('.ps-month')).toHaveCount(1);
  });
});

test.describe('Мобильный первый экран (18.2)', () => {
  test.use({ viewport: { width: 360, height: 640 } });

  test('360x640: профиль 56, поиск в шапке; hero выше 230; чипы под hero', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'mobile', 'мобильная раскладка');
    const m = await setup(page, context, baseURL!);
    m.profile = { onlineId: 'ArtemPS', avatarUrl: null, level: 312, levelProgress: 47, tier: 5, trophies: { platinum: 38, gold: 100, silver: 200, bronze: 500, total: 838 } };
    await page.goto('/');
    const h1 = page.getByRole('heading', { name: 'Коллекция', level: 1 });
    await expect(h1).toHaveCount(1);
    expect((await h1.boundingBox())?.width ?? 99).toBeLessThanOrEqual(1);
    const row = page.locator('section.ps-profile--row');
    await expect(row).toBeVisible();
    expect(Math.round((await row.boundingBox())!.height)).toBe(56);
    await expect(row).toContainText('Ур. 312');
    await expect(row.getByLabel('Платина 38')).toBeVisible();
    // D-P2 (пакет 2): поиск на мобильном открывается из шапки, строки поиска в первом экране нет
    await expect(page.getByRole('searchbox', { name: 'Поиск игры' })).toHaveCount(0);
    await expect(page.getByTestId('hdr-search')).toBeVisible();
    const hero = page.getByRole('region', { name: 'Играю сейчас' });
    await expect(hero).toBeVisible();
    // «С прошлого визита» (Фаза 28): в e2e нет серверного seed, поэтому сначала скелет. С п. B он не схлопывается при пустом ответе
    // (иначе CLS ~0.04), а остаётся коробкой «ничего нового». На проде `/` приходит с ответом в HTML, и пустая полоса не рендерится,
    // поэтому правило 18.2 (hero не ниже 232) проверяем для раскладки без этой коробки: hero сразу под ней.
    await expect(page.getByTestId('inbox-skeleton')).toHaveCount(0);
    const hb = (await hero.boundingBox())!;
    const reserved = page.getByTestId('inbox-reserved');
    const rb = (await reserved.count()) ? await reserved.boundingBox() : null;
    const above = rb ? hb.y - rb.y : 0;
    expect(above).toBeLessThanOrEqual(rb ? rb.height + 24 : 0);
    expect(hb.y - above).toBeLessThanOrEqual(232);
    expect(640 - 56 - hb.y).toBeGreaterThanOrEqual(100);
    const chips = page.getByRole('group', { name: 'Статус' });
    expect((await chips.boundingBox())!.y).toBeGreaterThan(hb.y + hb.height - 1);
  });

  test('кнопка «Фильтры»: sheet с сортировкой и видом, точка при изменённом виде', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name !== 'mobile', 'мобильная раскладка');
    await setup(page, context, baseURL!);
    await page.goto('/');
    const btn = page.getByRole('button', { name: /Фильтры и сортировка/ });
    await expect(btn.locator('.ps-notify-dot')).toHaveCount(0);
    await btn.click();
    const dlg = page.getByRole('dialog', { name: 'Фильтры' });
    await expect(dlg.getByLabel('Сортировка')).toBeVisible();
    await dlg.getByRole('group', { name: 'Вид' }).getByRole('button', { name: 'Плотно' }).click();
    await dlg.getByRole('button', { name: 'Готово' }).click();
    await expect(btn.locator('.ps-notify-dot')).toHaveCount(1);
    await expect(page.locator('.ps-filters__row2')).toHaveCount(0);
  });
});

test.describe('Ссылка на игру /?game=<id> (18.6)', () => {
  test('прямая ссылка открывает окно поверх коллекции; закрытие оставляет на /', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await page.goto('/?game=3');
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByRole('heading', { name: 'Horizon Forbidden West' })).toBeVisible();
    await expect(page).toHaveTitle(/Horizon Forbidden West · PS Tracker/);
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Коллекция', level: 1 })).toBeFocused();
  });

  test('окно открывается сразу при пустом списке (скелет), список грузится параллельно', async ({ page, context, baseURL }) => {
    const m = await setup(page, context, baseURL!);
    m.delayList = () => 1500;
    await page.goto('/?game=3');
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Horizon Forbidden West' })).toBeVisible({ timeout: 1400 });
  });

  test('?tab=trophies открывает вкладку «Трофеи»', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await page.goto('/?game=1&tab=trophies');
    await expect(page.getByRole('tab', { name: /Трофеи/ })).toHaveAttribute('aria-selected', 'true');
  });

  for (const bad of ['99999', 'abc', '-3']) {
    test(`id ${bad}: окно не открывается, параметр убран, тост`, async ({ page, context, baseURL }) => {
      await setup(page, context, baseURL!);
      await page.goto(`/?game=${bad}`);
      await expect(page.getByText('Игра не найдена. Возможно, ссылка устарела.')).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { name: '2026', level: 2 })).toBeVisible();
    });
  }

  test('ошибка сети: окно с панелью, «Повторить» подгружает игру', async ({ page, context, baseURL }) => {
    const m = await setup(page, context, baseURL!);
    m.listFails = true;
    m.failDetails = 500;
    await page.goto('/?game=3');
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByRole('heading', { name: 'Не удалось загрузить игру' })).toBeVisible();
    await expect(page).toHaveURL(/game=3/);
    m.failDetails = null;
    await dlg.getByRole('button', { name: 'Повторить' }).click();
    await expect(dlg.getByRole('heading', { name: 'Horizon Forbidden West' })).toBeVisible();
  });

  test('клик по карточке ставит ?game=, «назад» закрывает окно', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await page.goto('/');
    await page.getByRole('button', { name: /^Открыть: God of War/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL(/[?&]game=4/);
    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).not.toHaveURL(/game=/);
    // повторное открытие и закрытие крестиком тоже возвращает на /
    await page.getByRole('button', { name: /^Открыть: God of War/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).not.toHaveURL(/game=/);
  });

  test('«Открыть игру» из Плана ведёт на /?game=<id>', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await mockRoadmap(page, baseState());
    await page.goto('/roadmap');
    await page.getByRole('button', { name: /^Ещё: Хейдес/ }).first().click();
    await page.getByRole('menuitem', { name: 'Открыть игру' }).click();
    await expect(page).toHaveURL(/\/\?game=1$/);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/roadmap/);
  });
});

test.describe('404 (18.4)', () => {
  test('неизвестный путь: страница не найдена с ссылкой в коллекцию', async ({ page, context, baseURL }) => {
    await setup(page, context, baseURL!);
    await page.goto('/net-takoj-stranicy');
    await expect(page.getByRole('heading', { name: 'Страница не найдена', level: 1 })).toBeVisible();
    await expect(page.getByText('404')).toBeVisible();
    await expect(page).toHaveTitle('Не найдено · PS Tracker');
    await page.getByRole('link', { name: 'В коллекцию' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('Скелеты без скачков, CLS <= 0.05 (18.4)', () => {
  for (const [name, w, h] of [['1440', 1440, 900], ['390', 390, 844]] as const) {
    test(`Коллекция и Статистика, ${name}`, async ({ page, context, baseURL }, info) => {
      test.skip(info.project.name === 'mobile', 'размер задаётся вручную');
      const m = await setup(page, context, baseURL!);
      m.delayList = () => 3000; // с запасом: замер должен начаться, пока список ещё скелет
      m.profile = { onlineId: 'ArtemPS', avatarUrl: null, level: 312, levelProgress: 47, tier: 5, trophies: { platinum: 38, gold: 100, silver: 200, bronze: 500, total: 838 } };
      await mockStats(page, 1500);
      await page.setViewportSize({ width: w, height: h });
      await trackCls(page);
      await page.goto('/');
      await resetCls(page);
      await expect(page.locator('.ps-sk-hero2'), 'замер начат до подмены скелета данными').toBeVisible({ timeout: 1 });
      await expect(page.getByRole('heading', { name: '2026', level: 2 })).toBeVisible();
      await page.waitForTimeout(600);
      const c1 = await cls(page);
      if (c1 > 0.05) console.log(await page.evaluate(() => (window as unknown as { __lsDebug: string }).__lsDebug));
      expect(c1, `CLS коллекции ${name}`).toBeLessThanOrEqual(0.05);
      await page.goto('/stats');
      await resetCls(page);
      await expect(page.getByRole('heading', { name: 'Часы по месяцам' })).toBeVisible();
      await page.waitForTimeout(600);
      expect(await cls(page), `CLS статистики ${name}`).toBeLessThanOrEqual(0.05);
    });
  }

  test('Бэклог: скелет без скачков на 390 и 1440', async ({ page, context, baseURL }, info) => {
    test.skip(info.project.name === 'mobile', 'размер задаётся вручную');
    const m = await setup(page, context, baseURL!);
    m.delayList = () => 1500;
    await trackCls(page);
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/backlog');
      await resetCls(page);
      await expect(page.locator('.ps-bl-list')).toBeVisible();
      await page.waitForTimeout(600);
      // Фаза 33: на мобильном список стоит выше на экране, а плашка «Бэклог · Сервис» приезжает отдельным запросом (+44 px), поэтому тот же сдвиг весит больше
      expect(await cls(page), `CLS бэклога ${w}`).toBeLessThanOrEqual(w < 768 ? 0.08 : 0.05);
    }
  });

  test('reduced-motion: shimmer выключен', async ({ page, context, baseURL }) => {
    const m = await setup(page, context, baseURL!);
    m.delayList = () => 2000;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('.ps-skeleton').first()).toBeVisible();
    // Скелет может быть заменён при гидратации (узел отсоединяется, getComputedStyle даёт ''), поэтому читаем стиль свежим запросом и ждём устойчивого значения.
    await expect.poll(() => page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('.ps-skeleton')).filter((e) => e.isConnected);
      return els.length ? els.every((e) => getComputedStyle(e).animationName === 'none') : 'no-skeleton';
    })).toBe(true);
  });
});
