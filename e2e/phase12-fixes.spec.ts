// Правки по замечаниям Артёма: «Предстоящие» и «Убрать из плана», «Не успеваю» (позиция, тост), таймлайн по дням, страница «Бэклог».
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G, type Status } from './collection-mock';
import { baseState, mockRoadmap, upc, type RmPlanned, type RmState } from './roadmap-mock';
import { signedSession } from './session';
import { THEMES, THEME_STORAGE_KEY } from '../src/ui/tokens';

async function open(page: Page, context: BrowserContext, baseURL: string, s: RmState = baseState()): Promise<RmState> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, []);
  await mockRoadmap(page, s);
  await page.goto('/roadmap');
  await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
  return s;
}
const rel = (id: number, title: string, date: string | null, o: Partial<RmPlanned> = {}): RmPlanned => ({
  id, title, releaseDate: date, coverUrl: null, wantAtRelease: false, hoursManual: null, externalSource: null, externalId: null, status: 'planned', ...o,
});
const rowKeys = (page: Page) => page.getByTestId('rm-queue-row').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.rmKey));
const upcRow = (page: Page) => page.getByTestId('rm-upcoming-row').first();

test.describe('Предстоящие релизы: «Убрать из плана» со всех путей', () => {
  const fresh = () => baseState({ upcoming: { pages: [[upc(1, { title: 'Новинка 1', releaseDate: '2026-12-11' })]], fail: null } });
  const addFirst = async (page: Page) => {
    await upcRow(page).getByRole('button', { name: 'В план: Новинка 1' }).click();
    await expect(upcRow(page)).toHaveAttribute('data-state', 'planned');
  };
  const paths: [string, (page: Page) => Promise<void>][] = [
    ['из очереди (меню строки)', async (page) => {
      await page.getByRole('button', { name: 'Ещё: Новинка 1' }).click();
      await page.getByRole('menuitem', { name: 'Убрать из плана' }).click();
    }],
    ['из блока «Релизы»', async (page) => { await page.getByRole('button', { name: 'Убрать из плана: Новинка 1' }).first().click(); }],
    ['из блока «Нужны часы»', async (page) => { await page.getByTestId('rm-need-row').getByRole('button', { name: 'Убрать из плана: Новинка 1' }).click(); }],
  ];
  for (const [name, run] of paths) {
    test(`${name}: строка каталога показывает «Не распределено» и «Вернуть в план»`, async ({ page, context, baseURL }) => {
      const s = await open(page, context, baseURL as string, fresh());
      await addFirst(page);
      await run(page);
      await expect(upcRow(page)).toHaveAttribute('data-state', 'unallocated');
      await expect(upcRow(page)).toContainText('Не распределено');
      await expect(page.getByTestId('rm-release')).toHaveCount(0);
      await expect(page.getByTestId('rm-unallocated')).toContainText('Новинка 1');
      await upcRow(page).getByRole('button', { name: 'Вернуть в план' }).click();
      await expect(upcRow(page)).toHaveAttribute('data-state', 'planned');
      expect(s.calls.patches.at(-1)?.body).toEqual({ status: 'planned' });
      await expect(page.getByTestId('rm-release')).toHaveCount(1);
    });
  }

  test('из блока «Не успеваю»', async ({ page, context, baseURL }) => {
    const s = baseState({
      planned: [rel(5, 'Новинка 1', '2027-02-01', { wantAtRelease: true, hoursManual: 14, externalSource: 'rawg', externalId: '1' })],
      upcoming: { pages: [[upc(1, { title: 'Новинка 1', releaseDate: '2027-02-01' })]], fail: null },
    });
    await open(page, context, baseURL as string, s);
    await expect(upcRow(page)).toHaveAttribute('data-state', 'planned');
    await page.locator('#rm-over').getByRole('button', { name: 'Убрать из плана: Новинка 1' }).click();
    await expect(upcRow(page)).toHaveAttribute('data-state', 'unallocated');
    await expect(page.locator('#rm-over')).toHaveCount(0);
    await upcRow(page).getByRole('button', { name: 'Вернуть в план' }).click();
    await expect(upcRow(page)).toHaveAttribute('data-state', 'planned');
  });

  test('удаление совсем возвращает «В план»', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, fresh());
    await addFirst(page);
    await page.getByRole('button', { name: 'Удалить: Новинка 1' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(page.getByTestId('rm-release')).toHaveCount(0);
    await expect(upcRow(page)).toHaveAttribute('data-state', 'new');
    await expect(upcRow(page).getByRole('button', { name: 'В план: Новинка 1' })).toBeVisible();
  });

  test('кандидат загружен до добавления: после перезагрузки страницы пометки по записям тоже верны', async ({ page, context, baseURL }) => {
    const s = baseState({
      planned: [{ ...rel(9, 'Новинка 1', '2026-12-11', { externalSource: 'rawg', externalId: '1' }), status: 'cancelled' }],
      upcoming: { pages: [[upc(1, { title: 'Новинка 1', releaseDate: '2026-12-11' })]], fail: null },
    });
    await open(page, context, baseURL as string, s);
    await expect(upcRow(page)).toHaveAttribute('data-state', 'unallocated');
    await expect(page.getByTestId('rm-release')).toHaveCount(0);
  });
});

test.describe('«Не успеваю»: позиция в очереди и пересчёт', () => {
  const big = (o: Partial<RmState> = {}) => baseState({
    games: [{ id: 1, title: 'Игра А', hours: 250 }, { id: 2, title: 'Игра Х', hours: 300 }, { id: 3, title: 'Игра Б', hours: 40 }],
    order: [1, 2, 3], ...o,
  });

  test('подсказка с вытеснением, кнопка «Поставить на позицию N»: PUT по ключам, тост, блок пересчитан', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, big({ insertHints: { 2: { insertAt: 1, displacesAtInsert: 1, displacedTitles: ['Игра А'] } } }));
    const over = page.locator('#rm-over');
    await expect(over.getByTestId('rm-end-hint')).toHaveText('Влезет на позиции 1, вытеснит 1: «Игра А»');
    await expect(over.getByTestId('rm-end-hint')).toHaveAttribute('data-tone', 'warn');
    await expect(over).toContainText('Не влезла по порядку очереди. Освободить время можно, убрав игры раньше неё или поставив её выше.');
    await over.getByRole('button', { name: 'Поставить на позицию 1' }).click();
    await expect(page.getByText('Поставлено на позицию 1. Не успеваю: было 1, стало 0')).toBeVisible();
    expect(s.calls.orders).toEqual([[2, 1, 3]]);
    await expect(page.locator('#rm-over')).toHaveCount(0);
    expect(await rowKeys(page)).toEqual(['g:2', 'g:1', 'g:3']);
  });

  test('«никого не вытеснит», «нигде не влезет» без кнопки, нет полей: ни подсказки, ни кнопки', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, big({ insertHints: { 2: { insertAt: 1, displacesAtInsert: 0, displacedTitles: [] } } }));
    await expect(page.getByTestId('rm-end-hint')).toHaveText('Влезет на позиции 1, никого не вытеснит');
    await expect(page.getByTestId('rm-to-pos')).toContainText('Поставить на позицию 1');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    const s2 = await open(page, context, baseURL as string, big({ insertHints: { 2: { insertAt: null, displacesAtInsert: 0, displacedTitles: [] } } }));
    await expect(page.getByTestId('rm-end-hint')).toHaveText('Нигде не влезет: слишком длинная или мешают релизы');
    await expect(page.getByTestId('rm-to-pos')).toHaveCount(0);
    expect(s2.calls.orders).toEqual([]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await open(page, context, baseURL as string, big());
    await expect(page.getByTestId('rm-end-hint')).toHaveCount(0);
    await expect(page.getByTestId('rm-to-pos')).toHaveCount(0);
  });

  test('не помогло: игра остаётся в «Не успеваю», тост объясняет', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, big({
      games: [{ id: 1, title: 'Игра А', hours: 250 }, { id: 2, title: 'Игра Х', hours: 600 }, { id: 3, title: 'Игра Б', hours: 40 }],
      insertHints: { 2: { insertAt: 1, displacesAtInsert: 0, displacedTitles: [] } },
    }));
    await page.getByTestId('rm-to-pos').click();
    await expect(page.getByText(/Не влезла и на позиции 1/)).toBeVisible();
    await expect(page.locator('#rm-over')).toContainText('Игра Х');
  });

  test('«Убрать из плана»: перезапрос, тост «было N, стало M», блок и счётчик без перезагрузки страницы', async ({ page, context, baseURL }) => {
    const s = await open(page, context, baseURL as string, big());
    await expect(page.getByRole('link', { name: 'Не успеваю: 1' })).toBeVisible();
    const before = s.calls.roadmap;
    await page.getByRole('button', { name: 'Ещё: Игра А' }).click();
    await page.getByRole('menuitem', { name: 'Убрать из плана' }).click();
    await expect(page.getByText('Убрано из плана. Не успеваю: было 1, стало 0')).toBeVisible();
    expect(s.calls.roadmap).toBeGreaterThan(before);
    await expect(page.locator('#rm-over')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Не успеваю:/ })).toHaveCount(0);
    expect(await rowKeys(page)).toEqual(['g:2', 'g:3']);
  });

  test('если освободившееся время не помогло: «было 1, стало 1», сумма «не хватает» остаётся', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, big());
    await page.getByRole('button', { name: 'Ещё: Игра Б' }).click();
    await page.getByRole('menuitem', { name: 'Убрать из плана' }).click();
    await expect(page.getByText('Убрано из плана. Не успеваю: было 1, стало 1')).toBeVisible();
    await expect(page.locator('#rm-over')).toContainText('Игра Х');
    await expect(page.locator('#rm-over')).toContainText('Не хватает');
  });
});

test.describe('Таймлайн по дням', () => {
  test('очередь одной дорожкой встык, чередование тона, месяцы по реальным границам', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'Gantt на десктопе');
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, context, baseURL as string);
    const bars = page.locator('.ps-rm-bar[data-kind="queue"]');
    await expect(bars).toHaveCount(3);
    const geo = await bars.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, alt: (e as HTMLElement).dataset.alt }; }));
    expect(new Set(geo.map((g) => Math.round(g.t))).size).toBe(1); // одна дорожка
    for (let i = 0; i < geo.length - 1; i++) {
      expect(geo[i].r).toBeLessThanOrEqual(geo[i + 1].l + 1); // не перекрываются
      expect(geo[i + 1].l - geo[i].r).toBeLessThan(6); // встык: игры идут день за днём
    }
    expect(geo.map((g) => g.alt)).toEqual(['0', '1', '0']);
    expect(await page.getByTestId('rm-lane-queue').evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(40);
    // февраль начинается с 32-го дня: 31/365
    const feb = await page.locator('.ps-rm-g__month').nth(1).evaluate((el) => (el as HTMLElement).style.left);
    expect(parseFloat(feb)).toBeCloseTo((31 / 365) * 100, 1);
    // подписи не обрезаны «…» у длинных полос
    await expect(bars.nth(1).locator('.ps-rm-bar__t')).toBeVisible();
  });

  test('релизы своей дорожкой, не пересекающиеся полосы релизов в одной строке', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'Gantt на десктопе');
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, context, baseURL as string, baseState({
      planned: [rel(1, 'Релиз А', '2026-11-02', { wantAtRelease: true, hoursManual: 10 }), rel(2, 'Релиз Б', '2026-12-07', { wantAtRelease: true, hoursManual: 10 })],
    }));
    await expect(page.locator('.ps-rm-bar[data-kind="release"]')).toHaveCount(2);
    const tops = await page.locator('.ps-rm-bar[data-kind="release"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(tops).toHaveLength(2);
    expect(new Set(tops).size).toBe(1);
  });
});

// ---------- страница «Бэклог» ----------
const g = (id: number, title: string, status: Status | null): G => ({
  id, title, lastPlayedAt: `2026-01-${String((id % 28) + 1).padStart(2, '0')}T10:00:00.000Z`, status, completedAt: null, droppedAt: null, playSeconds: 3600, playCount: 1, trophies: null,
});
const many = (): G[] => [...Array.from({ length: 24 }, (_, i) => g(i + 1, `Бэклог игра ${i + 1}`, 'backlog')), g(100, 'Сервис игра 1', 'service'), g(101, 'Сервис игра 2', 'service')];

async function openBacklog(page: Page, context: BrowserContext, baseURL: string, games: G[], theme?: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  if (theme) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [THEME_STORAGE_KEY, theme]);
  await mockApi(page, games);
  await page.goto('/backlog');
  await page.getByRole('heading', { name: 'Бэклог', level: 1 }).waitFor();
  await page.locator('.ps-bl-list .ps-card:not(.ps-card--sk), .ps-empty').first().waitFor();
}

test.describe('Бэклог: заголовки, переключатель, кнопки на карточках', () => {
  test('заголовок «Бэклог» с количеством и переключатель-якорь «Бэклог N · Сервис M»', async ({ page, context, baseURL }) => {
    await openBacklog(page, context, baseURL as string, many());
    await expect(page.getByTestId('bl-main-count')).toHaveText('24');
    const jump = page.getByTestId('bl-jump');
    await expect(jump.getByRole('button', { name: /Бэклог 24/ })).toBeVisible();
    await expect(jump.getByRole('button', { name: /Сервис 2/ })).toBeVisible();
    await jump.getByRole('button', { name: /Сервис 2/ }).click();
    await expect(page.locator('#h-bl-service')).toBeFocused();
    await expect.poll(() => page.locator('#h-bl-service').evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThan(55); // не под шапкой
    await jump.getByRole('button', { name: /Бэклог 24/ }).click();
    await expect(page.locator('#h-bl-main')).toBeFocused();
    await expect.poll(() => page.locator('#h-bl-main').evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThan(55);
  });

  test('без игр-сервисов переключателя нет, подпись «Бэклог» есть', async ({ page, context, baseURL }) => {
    await openBacklog(page, context, baseURL as string, [g(1, 'Альфа', 'backlog'), g(2, 'Браво', 'backlog')]);
    await expect(page.getByTestId('bl-jump')).toHaveCount(0);
    await expect(page.getByTestId('bl-main-count')).toHaveText('2');
  });

  for (const t of THEMES) {
    for (const width of [360, 1280]) {
      test(`кнопки карточек единообразны: тема ${t.id}, ${width} px`, async ({ page, context, baseURL, isMobile }) => {
        test.skip(isMobile && width === 1280, 'ширина задаётся вручную один раз');
        await page.setViewportSize({ width, height: 900 });
        await openBacklog(page, context, baseURL as string, many().slice(0, 6).concat([g(100, 'Сервис игра с очень длинным названием', 'service')]), t.id);
        const rows = await page.locator('.ps-bl-actions').evaluateAll((boxes) => boxes.map((box) => Array.from(box.querySelectorAll('button')).map((b) => {
          const r = b.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), clipped: b.scrollWidth > b.clientWidth + 1 };
        })));
        expect(rows.length).toBeGreaterThan(5);
        const hs = new Set(rows.flat().map((b) => b.h));
        expect(hs.size).toBe(1); // одна высота у всех кнопок
        for (const box of rows) {
          expect(new Set(box.map((b) => b.w)).size).toBe(1); // в карточке одна ширина
          expect(box.every((b) => !b.clipped)).toBe(true); // текст без обрезания и переносов
        }
        expect(new Set(rows.map((r) => r[0].w)).size).toBe(1); // у всех карточек одна ширина
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      });
    }
  }
});

test.describe('«Не успеваю»: устойчивая раскладка строк', () => {
  const longName = 'Я'.repeat(300);
  const state = () => baseState({
    games: [
      { id: 1, title: 'Игра А', hours: 250 },
      { id: 2, title: 'Stellar Blade', hours: 300 }, { id: 3, title: 'Split Fiction', hours: 300 }, { id: 4, title: 'Days Gone', hours: 300 },
      { id: 5, title: 'Dark Souls II: Scholar of the First Sin Complete Edition', hours: 300 }, { id: 6, title: longName, hours: 300 }, { id: 7, title: 'Без подсказки', hours: 300 },
      { id: 8, title: 'Нигде не влезет', hours: 300 },
    ],
    order: [1, 2, 3, 4, 5, 6, 7, 8],
    planned: [rel(40, 'Релиз после конца года с длинным названием для проверки переноса', '2027-02-01', { wantAtRelease: true, hoursManual: 14 })],
    insertHints: {
      2: { insertAt: 25, displacesAtInsert: 1, displacedTitles: ['Cyberpunk 2077'] },
      3: { insertAt: 12, displacesAtInsert: 3, displacedTitles: ['The Witcher 3: Wild Hunt Game of the Year Edition', 'Red Dead Redemption 2', 'Assassins Creed Valhalla Ragnarok'] },
      4: { insertAt: 2, displacesAtInsert: 0, displacedTitles: [] },
      5: { insertAt: 7, displacesAtInsert: 1, displacedTitles: ['Игра с очень длинным названием без вариантов сократить'] },
      6: { insertAt: 3, displacesAtInsert: 0, displacedTitles: [] },
      8: { insertAt: null, displacesAtInsert: 0, displacedTitles: [] },
    },
  });

  for (const width of [320, 360, 768, 1280]) {
    test(`${width} px: название не схлопывается, действия в одной строке, нет горизонтального скролла`, async ({ page, context, baseURL, isMobile }) => {
      test.skip(isMobile && width > 400, 'ширина задаётся вручную один раз');
      await page.setViewportSize({ width, height: 900 });
      await open(page, context, baseURL as string, state());
      const items = page.getByTestId('rm-over-item');
      await expect(items).toHaveCount(8);
      const geo = await items.evaluateAll((els) => els.map((li) => {
        const b = li.querySelector('.ps-rm-over__tx b') as HTMLElement;
        const r = b.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(b).lineHeight);
        const acts = Array.from(li.querySelectorAll('[data-testid="rm-over-actions"] button')).map((x) => Math.round(x.getBoundingClientRect().top));
        const hint = li.querySelector('[data-testid="rm-end-hint"]') as HTMLElement | null;
        const act = li.querySelector('[data-testid="rm-over-actions"]') as HTMLElement;
        return {
          w: r.width, lines: r.height / lh, acts: new Set(acts).size,
          hintBelow: hint ? hint.getBoundingClientRect().top >= act.getBoundingClientRect().bottom - 1 : true,
          hintWide: hint ? hint.getBoundingClientRect().width : 999,
          liW: li.getBoundingClientRect().width,
        };
      }));
      for (const g of geo) {
        expect(g.w).toBeGreaterThanOrEqual(120);
        expect(g.lines).toBeLessThan(4); // не больше 3 строк, никаких побуквенных колонок
        expect(g.acts).toBe(1); // кнопки в одной строке действий
        expect(g.hintBelow).toBe(true); // подсказка отдельной строкой под действиями
        expect(g.hintWide).toBeGreaterThan(g.liW * 0.6); // и на всю ширину карточки
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
});
