// Фаза 9 (UI): платина (карточка, чип), hero «Играю», окно игры с трофеями, профиль PSN.
// API эмулируется по контракту §9, §12 (e2e/collection-mock.ts), БД не нужна.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed, type G, type Mock, type MockProfile } from './collection-mock';
import { signedSession } from './session';

const SHOTS = process.env.SHOTS_DIR;
const PROFILE: MockProfile = {
  onlineId: 'Artem_PS', avatarUrl: null, level: 312, levelProgress: 47, tier: 7,
  trophies: { platinum: 38, gold: 410, silver: 1100, bronze: 2800, total: 4348 },
};
const SVG = (w: number, h: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#556"/></svg>`;

type Opts = { games?: G[]; profile?: MockProfile | null; url?: string; setup?: (m: Mock) => void };
async function open(page: Page, context: BrowserContext, baseURL: string, o: Opts = {}): Promise<Mock> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  const mock = await mockApi(page, o.games ?? seed());
  mock.profile = o.profile === undefined ? null : o.profile;
  o.setup?.(mock);
  await page.goto(o.url ?? '/?sort=last_played');
  await expect(page.getByRole('heading', { level: 1, name: o.url?.startsWith('/backlog') ? 'Бэклог' : 'Коллекция' })).toBeVisible();
  return mock;
}
const coll = (page: Page) => page.locator('section[aria-labelledby="coll-title"]');
const card = (page: Page, title: string) =>
  coll(page).locator('article.ps-card').filter({ has: page.locator('.ps-card__title', { hasText: new RegExp(`^${title}$`) }) });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const theme = (page: Page, t: 'night' | 'graphite' | 'ps5') =>
  page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
const isMobile = (name: string) => name === 'mobile';

test.describe('Фаза 9: платина', () => {
  test('карточка: бейдж, data-platinum, имя ссылки; без платины ничего нет; бейдж не пересекает фигуру статуса', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    const w = card(page, 'The Witcher 3: Wild Hunt');
    await expect(w).toHaveAttribute('data-platinum', 'true');
    await expect(w.locator('.ps-card__plat')).toBeVisible();
    await expect(w.locator('.ps-card__plat')).toHaveAttribute('title', 'Платина получена');
    await expect(w.getByRole('button', { name: 'Открыть: The Witcher 3: Wild Hunt, платина получена' })).toBeAttached();
    const g = card(page, 'God of War');
    await expect(g).not.toHaveAttribute('data-platinum', 'true');
    await expect(g.locator('.ps-card__plat')).toHaveCount(0);
    const [p, s] = await Promise.all([w.locator('.ps-card__plat').boundingBox(), w.locator('.ps-card__glyph').boundingBox()]);
    expect(p!.x + p!.width).toBeLessThanOrEqual(s!.x); // слева от фигуры
    // обводка и блик: псевдоэлементы обложки
    const pseudo = await w.locator('.ps-card__cover').evaluate((el) => ({ a: getComputedStyle(el, '::after').content, b: getComputedStyle(el, '::before').content }));
    expect(pseudo).toEqual({ a: '""', b: '""' });
  });

  test('карточка в плотном режиме: уголок 30, без пересечения', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { url: '/?sort=last_played&view=dense' });
    const b = await card(page, 'The Witcher 3: Wild Hunt').locator('.ps-card__plat').boundingBox();
    expect(Math.round(b!.width)).toBe(30);
  });

  test('строка списка: иконка платины после названия и заливка бара', async ({ page, context, baseURL }, info) => {
    test.skip(isMobile(info.project.name), 'таблица на десктопе');
    await open(page, context, baseURL!, { url: '/?sort=last_played&view=list' });
    const row = coll(page).locator('.ps-row[data-platinum="true"]');
    await expect(row).toHaveCount(1);
    await expect(row.locator('.ps-row__plat')).toBeVisible();
    await expect(row).toContainText('The Witcher 3: Wild Hunt');
  });

  test('чип «Платина»: счёт, фильтр, URL, И со статусом, сброс', async ({ page, context, baseURL }, info) => {
    await open(page, context, baseURL!);
    const chip = page.getByRole('button', { name: 'Платина: 1' });
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(coll(page).locator('article.ps-card')).not.toHaveCount(1);
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/platinum=1/);
    await expect(coll(page).locator('article.ps-card')).toHaveCount(1);
    await expect(card(page, 'The Witcher 3: Wild Hunt')).toBeVisible();
    if (!isMobile(info.project.name)) {
      await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
      await expect(page).not.toHaveURL(/platinum/);
      await expect(chip).toHaveAttribute('aria-pressed', 'false');
      await expect(coll(page).locator('article.ps-card')).not.toHaveCount(1);
    } else {
      await chip.click();
      await expect(page).not.toHaveURL(/platinum/);
    }
  });

  test('чип «Платина» комбинируется со статусом по И; пустая выдача даёт «Ничего не найдено»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, { url: '/?status=completed&platinum=1' });
    await expect(coll(page).locator('article.ps-card')).toHaveCount(1);
    await open(page, context, baseURL!, { url: '/?status=playing&platinum=1' });
    await expect(page.getByRole('heading', { name: 'Ничего не найдено' })).toBeVisible();
    await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
    await expect(page).not.toHaveURL(/platinum/);
    await expect(coll(page).locator('article.ps-card').first()).toBeVisible();
  });

  test('чип «Платина» в хронике: превью-блоки грузятся целиком, hero без платины скрыт', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!, { url: '/?platinum=1' });
    await expect.poll(() => m.listCalls.some((u) => u.searchParams.get('status') === 'backlog' && u.searchParams.get('limit') === '300')).toBe(true);
    await expect(page.locator('.ps-hero')).toHaveCount(0);
  });

  test('нет платин: чип disabled с подсказкой', async ({ page, context, baseURL }) => {
    const games = seed();
    for (const g of games) if (g.trophies) g.trophies.plat = false;
    await open(page, context, baseURL!, { games });
    const chip = page.getByRole('button', { name: 'Платина: 0' });
    await expect(chip).toBeDisabled();
    await expect(chip).toHaveAttribute('title', 'Платин пока нет');
  });

  test('токены платины по темам: Night, Graphite, PS5', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    const exp = { night: ['#9fd3f5', '40%'], graphite: ['#a9cbe6', '0%'], ps5: ['#7cc4f2', '55%'] } as const;
    for (const t of ['night', 'graphite', 'ps5'] as const) {
      await theme(page, t);
      const v = await page.evaluate(() => { const c = getComputedStyle(document.documentElement); return [c.getPropertyValue('--plat-2').trim(), c.getPropertyValue('--plat-glow-a').trim()]; });
      expect(v).toEqual([...exp[t]]);
      await expect(card(page, 'The Witcher 3: Wild Hunt').locator('.ps-card__plat')).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('Фаза 9: hero «Играю»', () => {
  test('одна игра: hero на всю ширину, факты, прогресс, aria-label, размытая обложка без bannerUrl', async ({ page, context, baseURL }, info) => {
    await open(page, context, baseURL!, { url: '/' });
    const hero = page.locator('.ps-hero__main');
    await expect(hero).toBeVisible();
    await expect(page.locator('.ps-hero__side')).toHaveCount(0);
    await expect(hero.getByRole('heading', { level: 2, name: 'Horizon Forbidden West' })).toBeVisible();
    await expect(hero.locator('.ps-hero__tag')).toHaveText('Играю');
    const facts = hero.locator('.ps-hero__facts');
    await expect(facts).toContainText('Наиграно');
    await expect(facts).toContainText('28 ч 17 м');
    await expect(facts).toContainText('54/78');
    await expect(facts).toContainText('Последний запуск');
    await expect(hero.getByRole('progressbar', { name: 'Прогресс трофеев' })).toHaveAttribute('aria-valuenow', '69');
    await expect(hero.locator('.ps-hero__pct')).toHaveText('69%');
    await expect(hero.getByRole('button', { name: 'Открыть: Horizon Forbidden West. Наиграно 28 ч 17 м, трофеи 54 из 78' })).toBeAttached();
    await expect(hero.locator('.ps-artbg[data-blur]')).toHaveCount(1); // нет bannerUrl
    await expect(hero.locator('.ps-hero__cover')).toHaveCount(1);
    const b = await hero.boundingBox();
    if (isMobile(info.project.name)) expect(Math.round((await hero.locator('.ps-artbg').boundingBox())!.height)).toBe(160);
    else expect(Math.round(b!.height)).toBe(320);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('bannerUrl: арт без резкой обложки; ошибка картинки = размытая обложка', async ({ page, context, baseURL }) => {
    await page.route('https://img.test/ok.svg', (r) => r.fulfill({ contentType: 'image/svg+xml', body: SVG(800, 450) }));
    await page.route('https://img.test/bad.svg', (r) => r.abort('failed'));
    const games = seed();
    games[2].bannerUrl = 'https://img.test/ok.svg';
    await open(page, context, baseURL!, { games, url: '/' });
    const hero = page.locator('.ps-hero__main');
    await expect(hero.locator('.ps-artbg:not([data-blur]) img')).toHaveAttribute('src', 'https://img.test/ok.svg');
    await expect(hero.locator('.ps-hero__cover')).toHaveCount(0);
    await expect(hero.locator('img')).toHaveAttribute('alt', '');
    const g2 = seed();
    g2[2].bannerUrl = 'https://img.test/bad.svg';
    await open(page, context, baseURL!, { games: g2, url: '/' });
    await expect(page.locator('.ps-hero__main .ps-artbg[data-blur]')).toHaveCount(1);
    await expect(page.locator('.ps-hero__main .ps-hero__cover')).toHaveCount(1);
  });

  test('нет игр «Играю»: блок скрыт', async ({ page, context, baseURL }) => {
    const games = seed();
    games[2].status = null;
    await open(page, context, baseURL!, { games, url: '/' });
    await expect(page.locator('.ps-hero')).toHaveCount(0);
  });

  test('2+ игр: hero и боковая колонка / трек; много игр: метка со счётчиком и прокрутка', async ({ page, context, baseURL }, info) => {
    const games = seed();
    for (const i of [5, 6, 7, 8, 9]) games[i].status = 'playing'; // + 5 = всего 6
    await open(page, context, baseURL!, { games, url: '/' });
    await expect(page.locator('.ps-hero__tag')).toHaveText('Играю 6');
    const minis = page.locator('.ps-hero__mini');
    await expect(minis).toHaveCount(5);
    const side = page.locator('.ps-hero__side');
    if (isMobile(info.project.name)) {
      await expect(page.locator('.ps-hero__more')).toHaveText('Играю ещё 5');
      expect(await side.evaluate((el) => getComputedStyle(el).scrollSnapType)).toContain('x');
      expect(await side.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      expect(Math.round((await minis.first().boundingBox())!.width)).toBe(220);
    } else {
      await expect(page.locator('.ps-hero__more')).toBeHidden();
      const wrap = page.locator('.ps-hero__sidewrap');
      await expect(wrap).toHaveAttribute('data-scrolls', 'true');
      expect(await side.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      expect(Math.round((await wrap.boundingBox())!.height)).toBe(320);
      const hb = (await page.locator('.ps-hero__main').boundingBox())!;
      const sb = (await side.boundingBox())!;
      expect(sb.x).toBeGreaterThanOrEqual(hb.x + hb.width); // колонка справа от hero
      // Tab по порядку: фокус на карточке прокручивает колонку
      await minis.nth(4).focus();
      await expect(minis.nth(4)).toBeInViewport();
    }
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('клик по hero и по компактной карточке открывает окно игры', async ({ page, context, baseURL }) => {
    const games = seed();
    games[5].status = 'playing';
    await open(page, context, baseURL!, { games, url: '/' });
    await page.locator('.ps-hero__hit').click();
    await expect(page.getByRole('dialog', { name: 'Horizon Forbidden West' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('.ps-hero__mini').click();
    await expect(page.getByRole('dialog', { name: 'Stray' })).toBeVisible();
  });

  test('hero в трёх темах без переполнения; платина получена: бейдж в hero', async ({ page, context, baseURL }) => {
    const games = seed();
    games[2].trophies = { earned: 78, defined: 78, plat: true };
    await open(page, context, baseURL!, { games, url: '/' });
    for (const t of ['night', 'graphite', 'ps5'] as const) {
      await theme(page, t);
      await expect(page.locator('.ps-hero__plat')).toBeVisible();
      await expect(page.locator('.ps-hero__main')).toHaveAttribute('data-platinum', 'true');
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/p9-hero-${t}.png` });
    }
  });
});

test.describe('Фаза 9: окно игры', () => {
  const dlgOf = (page: Page, name = 'Horizon Forbidden West') => page.getByRole('dialog', { name });

  test('шапка, плитки цифр, вкладки; блокировка прокрутки; Esc возвращает фокус на карточку', async ({ page, context, baseURL }, info) => {
    await open(page, context, baseURL!);
    const hit = card(page, 'Horizon Forbidden West').locator('.ps-card__hit');
    await hit.focus();
    await page.keyboard.press('Enter');
    const dlg = dlgOf(page);
    await expect(dlg).toBeVisible();
    await expect(dlg).toHaveAttribute('aria-modal', 'true');
    const tiles = dlg.locator('.ps-gd__tile');
    await expect(tiles).toHaveCount(3); // D-P4: часы · запуски · трофеи, платина строкой в «Трофеях»
    await expect(tiles.nth(0)).toContainText('28 ч 17 м');
    await expect(tiles.nth(1)).toContainText('посл.');
    await expect(tiles.nth(2)).toContainText('54/78');
    await expect(tiles.nth(2)).toContainText('69%');
    await expect(tiles.nth(2)).toContainText('без платины'); // в моках у Horizon платины нет
    await expect(dlg.getByRole('tab', { name: /Обзор/ })).toHaveAttribute('aria-selected', 'true');
    await expect(dlg.getByRole('tab', { name: /Трофеи/ })).toContainText('54/78');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    const cols = await dlg.locator('.ps-gd__tiles').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(3);
    const art = await dlg.locator('.ps-gd__art').boundingBox();
    expect(Math.round(art!.height)).toBe(isMobile(info.project.name) ? 120 : 144) // нет баннера и обложки: компактная шапка;
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await expect(hit).toBeFocused();
  });

  test('focus trap: Tab не выходит из окна', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await card(page, 'Horizon Forbidden West').locator('.ps-card__hit').click();
    await expect(dlgOf(page)).toBeVisible();
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
    }
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
    }
  });

  test('вкладки: стрелки, Home/End, роли tab и tabpanel', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await card(page, 'Horizon Forbidden West').locator('.ps-card__hit').click();
    const dlg = dlgOf(page);
    const overview = dlg.getByRole('tab', { name: /Обзор/ });
    const troph = dlg.getByRole('tab', { name: /Трофеи/ });
    await overview.focus();
    await page.keyboard.press('ArrowRight');
    await expect(troph).toBeFocused();
    await expect(troph).toHaveAttribute('aria-selected', 'true');
    await expect(dlg.getByRole('tabpanel', { name: /Трофеи/ })).toBeVisible();
    await page.keyboard.press('Home');
    await expect(overview).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(dlg.getByRole('tab', { name: 'Гайды' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(overview).toHaveAttribute('aria-selected', 'true');
  });

  test('«Обзор»: даты из деталей; «Трофеи»: список, редкость, скрытые, платина первой', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!);
    await card(page, 'Horizon Forbidden West').locator('.ps-card__hit').click();
    const dlg = dlgOf(page);
    await expect(dlg.getByText('1 мар. 2024')).toBeVisible(); // firstPlayedAt
    await expect(dlg.getByText('6 окт. 2026')).toBeVisible(); // statusChangedAt
    expect([...new Set(m.detailCalls)]).toEqual([3]); // dev-сервер (StrictMode) может продублировать запрос
    await dlg.getByRole('tab', { name: /Трофеи/ }).click();
    const rows = dlg.locator('li.ps-trophy');
    await expect(rows).toHaveCount(6);
    await expect(rows.first()).toContainText('Легенда');
    await expect(rows.first()).toHaveAttribute('data-type', 'platinum');
    await expect(rows.first()).toContainText('Ультра-редкий');
    await expect(rows.first()).toContainText('2,4%');
    await expect(rows.first()).toContainText('5 окт. 2026');
    await expect(dlg.getByRole('group', { name: 'Фильтр трофеев' }).getByRole('button', { name: /Все 6/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(dlg.getByRole('button', { name: /Получено 4/ })).toBeVisible();
    await expect(dlg.getByRole('button', { name: /Не получено 2/ })).toBeVisible();
    // скрытый не полученный: заглушки, редкость показывается
    const hidden = rows.filter({ hasText: 'Скрытый трофей' });
    await expect(hidden).toHaveCount(1);
    await expect(hidden).toContainText('Описание откроется после получения');
    await expect(hidden).toContainText('Очень редкий');
    await expect(hidden).toContainText('4,1%');
    await expect(hidden).toContainText('Не получено');
    await expect(hidden).toHaveAttribute('aria-label', 'Бронза: Скрытый трофей, скрытый, не получено');
    // редкость: <0,1%, неизвестная, получен без даты
    await expect(rows.nth(2)).toContainText('<0,1%');
    await expect(rows.nth(2)).toContainText('получен');
    await expect(rows.filter({ hasText: 'Редкость неизвестна' })).toHaveCount(1);
    // скрытые (пакет 5): метка «Скрытый» у полученного и не полученного
    await expect(rows.filter({ hasText: 'Трофей 4' }).locator('.ps-trophy__hidtag')).toHaveText('Скрытый');
    await expect(hidden.locator('.ps-trophy__hidtag')).toHaveText('Скрытый');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('фильтр и сортировка трофеев', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await card(page, 'Horizon Forbidden West').locator('.ps-card__hit').click();
    const dlg = dlgOf(page);
    await dlg.getByRole('tab', { name: /Трофеи/ }).click();
    const rows = dlg.locator('li.ps-trophy');
    await dlg.getByRole('button', { name: /Не получено 2/ }).click();
    await expect(rows).toHaveCount(2);
    await expect(dlg.getByRole('button', { name: /Не получено 2/ })).toHaveAttribute('aria-pressed', 'true');
    await dlg.getByRole('button', { name: /Получено 4/ }).click();
    await expect(rows).toHaveCount(4);
    await dlg.getByRole('button', { name: /Все 6/ }).click();
    const sort = dlg.getByLabel('Сортировка трофеев');
    await sort.selectOption('rare');
    await expect(rows.first()).toContainText('Легенда'); // rarity 0
    await sort.selectOption('common');
    await expect(rows.first()).toContainText('Трофей 5'); // rarity 3, 50%
    await sort.selectOption('recent');
    await expect(rows.first()).toContainText('Легенда'); // самый свежий earnedAt
    await expect(rows.last()).toContainText('Трофей');
    await sort.selectOption('game');
    await expect(rows.first()).toContainText('Легенда');
    expect(await page.evaluate(() => location.search)).not.toContain('sort=rare'); // фильтр и сорт локальные
  });

  test('состояния вкладки «Трофеи»: загрузка (шапка и плитки сразу), ошибка с повтором, пусто, пусто по фильтру', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!);
    // запас на нагрузку CI: детали грузятся с открытия окна, к клику по вкладке 900 мс уже истекали (флейк в shard 2)
    m.detailsDelay = 2500;
    await card(page, 'Horizon Forbidden West').locator('.ps-card__hit').click();
    const dlg = dlgOf(page);
    await expect(dlg.locator('.ps-gd__tile').first()).toContainText('28 ч 17 м'); // из GameItem, без ожидания деталей
    await dlg.getByRole('tab', { name: /Трофеи/ }).click();
    await expect(dlg.locator('[aria-busy="true"] .ps-trophy--sk')).toHaveCount(8);
    await expect(dlg.locator('li.ps-trophy:not(.ps-trophy--sk)')).toHaveCount(6);
    await page.keyboard.press('Escape');

    m.detailsDelay = 0;
    m.failDetails = 503;
    await card(page, 'Horizon Forbidden West').locator('.ps-card__hit').click();
    await dlg.getByRole('tab', { name: /Трофеи/ }).click();
    await expect(dlg.getByRole('heading', { name: 'Не удалось загрузить трофеи' })).toBeVisible();
    await expect(dlg.locator('.ps-gd__tile').first()).toContainText('28 ч 17 м'); // остальное окно работает
    m.failDetails = null;
    await dlg.getByRole('button', { name: 'Повторить' }).click();
    await expect(dlg.locator('li.ps-trophy')).toHaveCount(6);
    await page.keyboard.press('Escape');

    await card(page, 'God of War').locator('.ps-card__hit').click(); // нет трофеев
    const god = dlgOf(page, 'God of War');
    await god.getByRole('tab', { name: /Трофеи/ }).click();
    await expect(god.getByRole('heading', { name: 'Трофеев нет' })).toBeVisible();
    await expect(god.getByRole('group', { name: 'Фильтр трофеев' })).toHaveCount(0);
  });

  test('пусто по фильтру: «Показать все»', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!);
    m.trophies[3] = [{ setId: 1, trophyId: 0, type: 'gold', name: 'Один', detail: 'x', iconUrl: null, hidden: false, earned: true, earnedAt: null, rarity: 2, earnedRate: 9 }];
    await card(page, 'Horizon Forbidden West').locator('.ps-card__hit').click();
    const dlg = dlgOf(page);
    await dlg.getByRole('tab', { name: /Трофеи/ }).click();
    await dlg.getByRole('button', { name: /Не получено 0/ }).click();
    await expect(dlg.getByRole('heading', { name: 'Нет трофеев по фильтру' })).toBeVisible();
    await dlg.getByRole('button', { name: 'Показать все' }).click();
    await expect(dlg.locator('li.ps-trophy')).toHaveCount(1);
  });

  test('длинный список: 100 строк и «Показать ещё 100»', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!);
    m.trophies[3] = Array.from({ length: 250 }, (_, i) => ({
      setId: 1, trophyId: i, type: 'bronze' as const, name: `Т${i}`, detail: 'd', iconUrl: null, hidden: false, earned: false, earnedAt: null, rarity: 3, earnedRate: 50,
    }));
    await card(page, 'Horizon Forbidden West').locator('.ps-card__hit').click();
    const dlg = dlgOf(page);
    await dlg.getByRole('tab', { name: /Трофеи/ }).click();
    await expect(dlg.locator('li.ps-trophy')).toHaveCount(100);
    await dlg.getByRole('button', { name: 'Показать ещё 100' }).click();
    await expect(dlg.locator('li.ps-trophy')).toHaveCount(200);
    await dlg.getByRole('button', { name: 'Показать ещё 50' }).click();
    await expect(dlg.locator('li.ps-trophy')).toHaveCount(250);
  });

  test('платина получена: иконка у названия и строка с датой в «Трофеях»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await card(page, 'The Witcher 3: Wild Hunt').locator('.ps-card__hit').click();
    const dlg = dlgOf(page, 'The Witcher 3: Wild Hunt');
    await expect(dlg.locator('.ps-gd__plat')).toBeVisible();
    const line = dlg.locator('.ps-gd__tile[data-tile="trophies"]').getByTestId('platinum-line');
    await expect(line).toHaveAttribute('data-state', 'earned');
    await expect(line).toHaveText('платина 5 окт. 2026');
  });

  test('смена статуса в окне и сброс; ссылка «Изменить статус» одна', async ({ page, context, baseURL }) => {
    const m = await open(page, context, baseURL!);
    await card(page, 'Stray').locator('.ps-card__hit').click();
    const dlg = dlgOf(page, 'Stray');
    await expect(dlg.getByText('6 окт. 2026')).toBeVisible(); // детали загружены
    const before = m.detailCalls.length;
    await expect(dlg.getByRole('button', { name: 'Изменить статус' })).toHaveCount(1);
    await dlg.getByRole('button', { name: 'Изменить статус' }).click();
    await page.getByRole('menuitemradio', { name: 'Играю' }).click();
    await expect.poll(() => m.mutations.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'playing' } });
    await expect(dlg.locator('.ps-chip')).toContainText('Играю');
    await expect.poll(() => m.detailCalls.length).toBeGreaterThan(before); // детали перечитаны после смены статуса
  });

  test('игра без трофеев и часов: «нет данных»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await card(page, 'Gran Turismo 7').locator('.ps-card__hit').click();
    const dlg = dlgOf(page, 'Gran Turismo 7');
    const tiles = dlg.locator('.ps-gd__tile');
    await expect(tiles).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(tiles.nth(i)).toContainText('нет данных');
  });

  test('три темы: окно без переполнения, закрытие кнопкой', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    for (const t of ['night', 'graphite', 'ps5'] as const) {
      await theme(page, t);
      await card(page, 'The Witcher 3: Wild Hunt').locator('.ps-card__hit').click();
      const dlg = dlgOf(page, 'The Witcher 3: Wild Hunt');
      await expect(dlg).toBeVisible();
      await dlg.getByRole('tab', { name: /Трофеи/ }).click();
      await expect(dlg.locator('li.ps-trophy').first()).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/p9-dialog-${t}.png` });
      await dlg.getByRole('button', { name: 'Закрыть' }).click();
      await expect(dlg).toHaveCount(0);
    }
  });

  test('reduced-motion: окно без анимации входа', async ({ page, context, baseURL }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, context, baseURL!);
    await card(page, 'Stray').locator('.ps-card__hit').click();
    const name = await dlgOf(page, 'Stray').evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toBe('none');
  });
});

test.describe('Фаза 9: профиль PSN', () => {
  test('блок профиля: ник, уровень, прогресс, счётчики трофеев; tier не показывается', async ({ page, context, baseURL }, info) => {
    await open(page, context, baseURL!, { profile: PROFILE });
    const p = page.locator('section.ps-profile');
    await expect(p).toBeVisible();
    await expect(p.locator('.ps-profile__nick')).toHaveText('Artem_PS');
    if (isMobile(info.project.name)) {
      // Фаза 18: на мобильном профиль одной строкой (56): ник, «Ур. 312», платина; золото/серебро/бронза/«Всего» в меню профиля
      await expect(p).toHaveClass(/ps-profile--row/);
      expect(Math.round((await p.boundingBox())!.height)).toBe(56);
      await expect(p.locator('.ps-profile__pill')).toHaveText('Ур. 312');
      await expect(p.locator('.ps-profile__pill')).toHaveAttribute('title', '47% до 313');
      await expect(p.getByRole('progressbar', { name: 'Прогресс до следующего уровня' })).toHaveAttribute('aria-valuenow', '47');
      await expect(p.getByLabel('Платина 38')).toBeVisible();
      await expect(p.getByLabel(/Золото/)).toHaveCount(0);
      await expect(p.locator('.ps-profile__total')).toHaveCount(0);
      await expect(p.locator('.ps-av')).toHaveCSS('width', '36px');
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      return;
    }
    await expect(p.locator('.ps-profile__pill')).toHaveText('Ур. 312');
    await expect(p.locator('.ps-profile__next')).toHaveText('47% до 313');
    await expect(p.getByRole('progressbar', { name: 'Прогресс до следующего уровня' })).toHaveAttribute('aria-valuenow', '47');
    await expect(p.getByLabel('Платина 38')).toBeVisible();
    await expect(p.getByLabel(/Золото 410/)).toBeVisible();
    await expect(p.getByLabel(/Серебро 1.100/)).toBeVisible();
    await expect(p.getByLabel(/Бронза 2.800/)).toBeVisible();
    await expect(p.locator('.ps-profile__total')).toHaveText(/Всего 4.348/);
    await expect(p.locator('.ps-av__ini')).toHaveText('A'); // avatarUrl = null
    const av = await p.locator('.ps-av').boundingBox();
    expect(Math.round(av!.width)).toBe(isMobile(info.project.name) ? 48 : 56);
    if (isMobile(info.project.name)) {
      await expect(page.locator('.ps-statline')).toBeVisible();
      const stat = await page.locator('.ps-statline').boundingBox();
      const pb = await p.boundingBox();
      expect(pb!.y).toBeGreaterThanOrEqual(stat!.y + stat!.height); // под StatLine
      const main = await page.locator('.ps-collection').boundingBox();
      expect(Math.round(pb!.width)).toBe(Math.round(main!.width)); // на всю ширину
    } else {
      const h1 = await page.getByRole('heading', { level: 1, name: 'Коллекция' }).boundingBox();
      const pb = await p.boundingBox();
      expect(pb!.x).toBeGreaterThan(h1!.x + 300); // справа
    }
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/p9-profile-${info.project.name}.png` });
  });

  test('профиль null или без ника: блока нет; нет уровня и счётчиков: частичный блок', async ({ page, context, baseURL }) => {
    // на мобильном без профиля может остаться строка итогов коллекции (D-P1, .ps-profile--totals), профиля в ней нет
    await open(page, context, baseURL!, { profile: null });
    await expect(page.locator('.ps-profile:not(.ps-profile--totals)')).toHaveCount(0);
    await open(page, context, baseURL!, { profile: { ...PROFILE, onlineId: '  ' } });
    await expect(page.locator('.ps-profile:not(.ps-profile--totals)')).toHaveCount(0);
    await open(page, context, baseURL!, { profile: { ...PROFILE, level: null, levelProgress: null, trophies: null } });
    await expect(page.locator('.ps-profile__nick')).toHaveText('Artem_PS');
    await expect(page.locator('.ps-profile__pill')).toHaveCount(0);
    await expect(page.locator('.ps-profile__bar')).toHaveCount(0);
    await expect(page.locator('.ps-profile__tr')).toHaveCount(0);
  });

  test('аватар: картинка PSN; ошибка загрузки = инициал', async ({ page, context, baseURL }) => {
    await page.route('https://avatar.test/ok.svg', (r) => r.fulfill({ contentType: 'image/svg+xml', body: SVG(64, 64) }));
    await page.route('https://avatar.test/bad.svg', (r) => r.abort('failed'));
    await open(page, context, baseURL!, { profile: { ...PROFILE, avatarUrl: 'https://avatar.test/ok.svg' } });
    const img = page.locator('.ps-profile img.ps-av__img');
    await expect(img).toHaveAttribute('alt', '');
    await expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(page.locator('.ps-profile .ps-av__ini')).toHaveCount(0);
    await open(page, context, baseURL!, { profile: { ...PROFILE, avatarUrl: 'https://avatar.test/bad.svg' } });
    await expect(page.locator('.ps-profile .ps-av__ini')).toHaveText('A');
  });

  test('шапка: аватар с меню профиля (ник, «Ур. 312 · 38 платин», пункты)', async ({ page, context, baseURL }, info) => {
    test.skip(isMobile(info.project.name), 'меню профиля на десктопе, на мобильном профиль в «⋯»');
    await open(page, context, baseURL!, { profile: PROFILE });
    const btn = page.getByRole('button', { name: 'Профиль Artem_PS' });
    await expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    await btn.click();
    const menu = page.getByRole('menu');
    await expect(menu.locator('.ps-profmenu__head')).toContainText('Artem_PS');
    await expect(menu.locator('.ps-profmenu__head')).toContainText('Ур. 312 · 38 платин');
    await expect(menu.getByRole('menuitem').filter({ hasText: 'Разобрать игры' })).toHaveCount(0); // Фаза 18: есть вкладка «Разбор»
    await expect(menu.getByRole('menuitem').filter({ hasText: /Скрытые игры|Выйти/ })).toHaveText([/Скрытые игры/, /^Выйти$/, /Выйти на всех устройствах/]);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

  test('шапка без профиля: заглушка и прежнее меню', async ({ page, context, baseURL }, info) => {
    test.skip(isMobile(info.project.name), 'десктоп');
    await open(page, context, baseURL!, { profile: null });
    await page.getByRole('button', { name: 'Меню профиля' }).click();
    await expect(page.locator('.ps-profmenu__head')).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Выйти', exact: true })).toBeVisible();
  });

  test('на других страницах профиль берётся из сводки (Бэклог)', async ({ page, context, baseURL }, info) => {
    test.skip(isMobile(info.project.name), 'десктоп');
    await open(page, context, baseURL!, { profile: PROFILE, url: '/backlog' });
    await expect(page.getByRole('button', { name: 'Профиль Artem_PS' })).toBeVisible();
  });

  test('мобильный: профиль в меню «⋯» верхней строкой', async ({ page, context, baseURL }, info) => {
    test.skip(!isMobile(info.project.name), 'мобильный');
    await open(page, context, baseURL!, { profile: PROFILE });
    await page.getByRole('button', { name: 'Меню', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Меню' });
    await expect(sheet.locator('.ps-profmenu__head')).toContainText('Artem_PS');
    await expect(sheet.locator('.ps-profmenu__head')).toContainText('Ур. 312 · 38 платин');
  });
});
