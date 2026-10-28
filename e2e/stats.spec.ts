// QA Фазы 5: экран /stats на моках /api/stats (БД в e2e недоступна). Форма ответа по контракту §10, не по реализации.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const SHOTS = process.env.SHOTS_DIR;
const TODAY = { year: Number(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 4)), month: Number(new Date(Date.now() + 3 * 3600_000).toISOString().slice(5, 7)) };
const FIRST = `${TODAY.year}-01-15`;
const z = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };

const game = (id: number, title: string, status: 'completed' | 'dropped') => ({
  id, title, coverUrl: null, platform: 'PS5', playSeconds: 36000, hours: 10, playCount: 3, lastPlayedAt: '2026-03-10T10:00:00.000Z',
  status, completedAt: status === 'completed' ? '2026-03-10T10:00:00.000Z' : null, droppedAt: status === 'dropped' ? '2026-03-12T10:00:00.000Z' : null,
  trophies: null, genres: [{ key: 'ACTION', label: 'Экшен' }],
});

type Opts = { empty?: boolean; hoursNull?: boolean; estimate?: boolean };
/** Ответ по контракту §10.1 для разобранных параметров. */
function respond(u: URL, o: Opts = {}) {
  const type = u.searchParams.get('period') === 'month' ? 'month' : 'year';
  const year = Number(u.searchParams.get('year') ?? TODAY.year);
  const month = type === 'month' ? Number(u.searchParams.get('month')) : null;
  const last = month ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 31;
  const p = (n: number) => String(n).padStart(2, '0');
  const has = !o.empty && year >= TODAY.year - 1;
  const byMonth = Array.from({ length: 12 }, (_, i) => (year < TODAY.year ? null : i + 1 > TODAY.month ? null : i === 0 ? (o.estimate ? 5 : null) : 10 + i));
  return {
    period: {
      type, year, month, from: `${year}-${p(month ?? 1)}-01`, to: `${year}-${p(month ?? 12)}-${p(last)}`,
      fromUtc: new Date(Date.UTC(year, (month ?? 1) - 1, 1) - 3 * 3600_000).toISOString(), toUtc: new Date(Date.UTC(year, (month ?? 12) - 1, last + 1) - 3 * 3600_000).toISOString(),
    },
    years: [TODAY.year, TODAY.year - 1],
    header: { completed: has ? 1 : 0, dropped: has ? 1 : 0, hours: o.hoursNull || year < TODAY.year ? null : has ? 123.4 : 0, platinum: has ? 2 : 0 },
    hours: {
      byMonth: has ? byMonth : byMonth.map(() => null),
      // оценка: январь целиком оценочный, февраль частично (контракт §10.1: estimatedByMonth <= byMonth)
      estimatedByMonth: has && o.estimate && year === TODAY.year ? byMonth.map((v, i) => (i === 0 ? 5 : i === 1 && v ? 4 : 0)) : Array(12).fill(0),
      estimatedHours: has && o.estimate ? 9 : 0, hasEstimate: !!has && !!o.estimate,
      firstSnapshotDate: FIRST, periodPartial: year <= TODAY.year && (month ?? 1) <= 1 || year < TODAY.year },
    genres: has
      ? { hasData: true, items: [{ key: 'ACTION', label: 'Экшен', value: 14.5, gameIds: [1, 2] }, { key: 'OTHER', label: 'Другое', value: 3, gameIds: [2] }], games: { 1: { id: 1, title: 'Игра Один', coverUrl: null }, 2: { id: 2, title: 'Игра Два', coverUrl: null } } }
      : { hasData: false, items: [], games: {} },
    top: has
      ? {
        byHours: [{ game: game(1, 'Игра Один', 'completed'), hours: 12.5, estimated: false }, { game: game(2, 'Игра Два', 'dropped'), hours: 2, estimated: true }],
        byTrophies: [{ game: game(1, 'Игра Один', 'completed'), points: 840, counts: { platinum: 1, gold: 5, silver: 12, bronze: 20, total: 38 } }],
      }
      : { byHours: [], byTrophies: [] },
    trophies: {
      counts: has ? { platinum: 2, gold: 3, silver: 4, bronze: 5, total: 14 } : z,
      byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...(has && i === 2 ? { platinum: 2, gold: 3, silver: 4, bronze: 5, total: 14 } : z) })),
    },
    finished: has
      ? { groups: [{ month: `${year}-03`, year, monthNumber: 3, items: [{ kind: 'completed', at: '2026-03-10T10:00:00.000Z', game: game(1, 'Игра Один', 'completed') }, { kind: 'dropped', at: '2026-03-12T10:00:00.000Z', game: game(2, 'Игра Два', 'dropped') }] }] }
      : { groups: [] },
    // «Игры месяца» (Фаза 8): мартовские завершения + «Игра Один» ещё и в феврале (играли, но не завершили)
    played: has
      ? { games: { 1: game(1, 'Игра Один', 'completed'), 2: game(2, 'Игра Два', 'dropped') }, groups: [
        { month: `${year}-03`, year, monthNumber: 3, completed: 1, dropped: 1, items: [
          { gameId: 2, hours: 2, estimated: false, finished: 'dropped', finishedAt: '2026-03-12T10:00:00.000Z' },
          { gameId: 1, hours: 12.5, estimated: false, finished: 'completed', finishedAt: '2026-03-10T10:00:00.000Z' },
        ] },
        { month: `${year}-02`, year, monthNumber: 2, completed: 0, dropped: 0, items: [
          { gameId: 1, hours: 7.5, estimated: true, finished: null, finishedAt: null },
        ] },
      ] }
      : { games: {}, groups: [] },
  };
}

type Ctl = { calls: URL[]; opts: Opts; fail: number | null };
async function open(page: Page, context: BrowserContext, baseURL: string, url = '/stats'): Promise<Ctl> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  const ctl: Ctl = { calls: [], opts: {}, fail: null };
  await page.route(/\/api\/stats\?/, (r) => {
    const u = new URL(r.request().url());
    ctl.calls.push(u);
    if (ctl.fail) return r.fulfill({ status: ctl.fail, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'db_unavailable', message: 'x' } }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: respond(u, ctl.opts) }) });
  });
  await page.goto(url);
  return ctl;
}
async function theme(page: Page, t: 'night' | 'graphite' | 'ps5') {
  await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const last = (c: Ctl) => c.calls[c.calls.length - 1];

test.describe('/stats', () => {
  test('год: шапка, 12 столбцов часов, жанры, трофеи, завершённые; без оценки нет плашки и легенды', async ({ page, context, baseURL }) => {
    const ctl = await open(page, context, baseURL!);
    await expect(page.getByRole('heading', { name: 'Часы по месяцам' })).toBeVisible();
    expect(last(ctl).searchParams.get('period')).toBe('year');
    await expect(page.locator('.ps-st-bar')).toHaveCount(12);
    await expect(page.locator('.ps-st-bar[data-nodata]').first()).toBeVisible(); // null-месяцы: кнопка есть, столбца нет
    await expect(page.locator('.ps-st-bar[data-nodata] .ps-st-bar__stack')).toHaveCount(0);
    await expect(page.locator('.ps-st-bar__hatch')).toHaveCount(0); // штриховка «нет данных» убрана
    await expect(page.locator('.ps-st-head')).toContainText('123,4 ч');
    await expect(page.locator('.ps-st-head')).not.toContainText('≈');
    await expect(page.getByRole('note')).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Обозначения' })).toHaveCount(0);
    await expect(page.locator('.ps-st-bar__est')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Жанры' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Трофеи' })).toBeVisible();
    await expect(page.locator('.ps-card__title', { hasText: 'Игра Один' })).toHaveCount(2); // март и февраль («Игры месяца»)
    await expect(page.locator('.ps-card__title', { hasText: 'Игра Два' })).toHaveCount(1);
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined|null|Invalid/);
  });

  test('оценка часов: стек «измерено + оценка», легенда, плашка, «≈» в шапке, подсказка с обеими частями', async ({ page, context, baseURL }) => {
    test.skip(TODAY.month < 2, 'нужны январь и февраль в графике');
    const ctl = await open(page, context, baseURL!, '/blank-never');
    ctl.opts = { estimate: true };
    await page.goto('/stats');
    await expect(page.locator('.ps-st-bar')).toHaveCount(12);
    // январь целиком оценка, февраль в части
    const jan = page.locator('.ps-st-bar').nth(0);
    const feb = page.locator('.ps-st-bar').nth(1);
    await expect(jan.locator('.ps-st-bar__est')).toHaveCount(1);
    await expect(jan.locator('.ps-st-bar__fill')).toHaveCount(0);
    await expect(feb.locator('.ps-st-bar__est')).toHaveCount(1);
    await expect(feb.locator('.ps-st-bar__fill')).toHaveCount(1);
    // измеренная снизу, оценочная сверху
    const [est, real] = await Promise.all([feb.locator('.ps-st-bar__est').boundingBox(), feb.locator('.ps-st-bar__fill').boundingBox()]);
    expect(est!.y + est!.height).toBeLessThanOrEqual(real!.y + 1.5);
    // март без оценки: только измеренная часть
    if (TODAY.month >= 3) await expect(page.locator('.ps-st-bar').nth(2).locator('.ps-st-bar__est')).toHaveCount(0);
    // диагональные полосы и пунктир, не только цвет
    const deco = await feb.locator('.ps-st-bar__est').evaluate((el) => {
      const after = getComputedStyle(el, '::after');
      const st = getComputedStyle(el);
      return { img: after.backgroundImage, border: st.borderTopStyle };
    });
    expect(deco.img).toContain('repeating-linear-gradient');
    expect(deco.border).toBe('dashed');
    // легенда и плашка
    const legend = page.getByRole('list', { name: 'Обозначения' });
    await expect(legend).toContainText('Измерено');
    await expect(legend).toContainText('Оценка');
    await expect(page.getByRole('note')).toHaveText(`До 15.01.${TODAY.year} часы оценены: распределены равномерно между первым и последним запуском игры. С этой даты часы измеряются по ежедневным снимкам.`);
    // KPI с «≈»
    await expect(page.locator('.ps-st-head')).toContainText('≈ 123,4 ч');
    await expect(page.locator('.ps-st-head [title="Часть часов оценена"]')).toBeVisible();
    // aria-label с обеими частями
    await expect(feb).toHaveAttribute('aria-label', `Февраль ${TODAY.year}: 11 ч, из них 4 ч оценка`);
    await expect(jan).toHaveAttribute('aria-label', `Январь ${TODAY.year}: 5 ч, из них 5 ч оценка`);
    // подсказка: обе части
    await feb.hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toContainText(`Февраль ${TODAY.year}`);
    await expect(tip).toContainText('11 ч всего');
    await expect(tip).toContainText('Измерено: 7 ч');
    await expect(tip).toContainText('Оценка: 4 ч');
    // целиком оценочный месяц: нулевая часть «Измерено» не выводится
    await jan.click();
    await expect(tip).toContainText('Оценка: 5 ч');
    await expect(tip).not.toContainText('Измерено');
    // подсказка без оценки: одна строка «Измерено»
    if (TODAY.month >= 3) {
      await page.locator('.ps-st-bar').nth(2).click();
      await expect(tip).toContainText('Измерено: 12 ч');
      await expect(tip).not.toContainText('Оценка');
    }
    if (SHOTS) await page.locator('.ps-st-panel--hours, .ps-st-panel--hours-wide').first().screenshot({ path: `${SHOTS}/stats-est-${test.info().project.name}.png` });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('оценка без снимков (firstSnapshotDate = null): плашка без даты', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/blank-never');
    await page.route(/\/api\/stats\?/, (r) => {
      const d = respond(new URL(r.request().url()), { estimate: true });
      const e = { ...d, hours: { ...d.hours, firstSnapshotDate: null, periodPartial: true } };
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: e }) });
    });
    await page.goto('/stats');
    await expect(page.getByRole('note')).toHaveText('Часы оценены: распределены равномерно между первым и последним запуском игры. Точные данные появятся после ежедневных синков.');
  });

  test('переключатель Год/Месяц и стрелки: URL, запросы, границы', async ({ page, context, baseURL }) => {
    const ctl = await open(page, context, baseURL!);
    await expect(page.locator('.ps-st-bar')).toHaveCount(12);
    await expect(page.getByRole('button', { name: 'Следующий год' })).toBeDisabled(); // нельзя в будущее
    await page.getByRole('button', { name: 'Месяц', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`period=month&year=${TODAY.year}&month=${TODAY.month}`));
    await expect.poll(() => last(ctl).searchParams.get('month')).toBe(String(TODAY.month));
    await expect(page.getByRole('button', { name: 'Следующий месяц' })).toBeDisabled();
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    if (TODAY.month > 1) await expect.poll(() => last(ctl).searchParams.get('month')).toBe(String(TODAY.month - 1));
    // назад до минимального года из years (TODAY.year-1), январь минимального года: дальше нельзя
    await page.goto(`/stats?period=month&year=${TODAY.year - 1}&month=2`);
    await page.getByRole('button', { name: 'Предыдущий месяц' }).click();
    await expect(page.getByRole('button', { name: 'Предыдущий месяц' })).toBeDisabled();
    // год: минимум
    await page.goto(`/stats?period=year&year=${TODAY.year - 1}`);
    await expect(page.getByRole('button', { name: 'Предыдущий год' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Следующий год' })).toBeEnabled();
    await page.getByRole('button', { name: 'Следующий год' }).click();
    await expect(page).toHaveURL(new RegExp(`year=${TODAY.year}`));
  });

  test('невалидные URL-параметры не ломают экран и не уходят в API мусором', async ({ page, context, baseURL }) => {
    for (const q of [
      'period=zzz&year=abc&month=99', 'period=month&month=13', 'period=month&month=0&year=1999', `period=year&year=${TODAY.year + 5}`,
      'year=-1', 'period=month&month=1.5', `year=${'9'.repeat(30)}`,
    ]) {
      const ctl = await open(page, context, baseURL!, `/stats?${q}`);
      await expect(page.getByRole('heading', { name: 'Статистика' })).toBeVisible();
      await expect(page.locator('.ps-st-head, [role=alert]').first()).toBeVisible();
      for (const c of ctl.calls) {
        expect(['year', 'month'], q).toContain(c.searchParams.get('period'));
        const y = Number(c.searchParams.get('year'));
        expect(y, q).toBeGreaterThanOrEqual(2000);
        expect(y, q).toBeLessThanOrEqual(TODAY.year);
        if (c.searchParams.get('period') === 'month') expect(Number(c.searchParams.get('month')), q).toBeGreaterThanOrEqual(1);
      }
      await expect(page.getByText('Что-то пошло не так')).toHaveCount(0);
    }
  });

  test('год без данных: пустое состояние, без NaN', async ({ page, context, baseURL }) => {
    const ctl = await open(page, context, baseURL!);
    ctl.opts = { empty: true };
    await page.goto(`/stats?period=year&year=${TODAY.year - 1}`);
    await expect(page.getByText('За этот период ничего нет')).toBeVisible();
    await expect(page.locator('.ps-st-head')).toContainText('— ч');
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined|null|Invalid/);
  });

  test('header.hours = null показывается как «— ч», не 0', async ({ page, context, baseURL }) => {
    const ctl = await open(page, context, baseURL!, '/blank-never');
    ctl.opts = { hoursNull: true };
    await page.goto('/stats');
    await expect(page.locator('.ps-st-head')).toContainText('— ч');
    await expect(page.locator('.ps-st-head')).not.toContainText('0 ч');
  });

  test('503: сообщение и «Повторить» восстанавливает экран; навигация после сбоя работает', async ({ page, context, baseURL }) => {
    const ctl = await open(page, context, baseURL!, '/blank-never');
    ctl.fail = 503;
    await page.goto('/stats');
    await expect(page.getByText('Что-то пошло не так')).toBeVisible();
    await expect(page.locator('.ps-st-bar')).toHaveCount(0);
    ctl.fail = null;
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.locator('.ps-st-bar')).toHaveCount(12);
    // повторный сбой при смене периода: ошибка, а не зависшие старые данные
    ctl.fail = 503;
    await page.getByRole('button', { name: 'Месяц', exact: true }).click();
    await expect(page.getByText('Что-то пошло не так')).toBeVisible();
    ctl.fail = null;
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByRole('heading', { name: 'Часы по месяцам' })).toBeVisible();
  });

  test('сбой 400 (рассинхрон контракта) не оставляет вечный скелетон', async ({ page, context, baseURL }) => {
    const ctl = await open(page, context, baseURL!, '/blank-never');
    ctl.fail = 400;
    await page.goto('/stats');
    await expect(page.getByText('Что-то пошло не так')).toBeVisible();
  });

  // BUG-S1: byMonth приходит за весь год, но для месяца без данных нужно пустое состояние
  test('пустой МЕСЯЦ внутри года с данными: пустое состояние (контракт: byMonth всегда год)', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/blank-never');
    await page.route(/\/api\/stats\?/, (r) => {
      const d = respond(new URL(r.request().url()));
      const e = { ...d, header: { completed: 0, dropped: 0, hours: 0, platinum: 0 }, genres: { hasData: false, items: [], games: {} }, top: { byHours: [], byTrophies: [] }, trophies: { counts: z, byMonth: d.trophies.byMonth.map((m) => ({ ...m, ...z })) }, finished: { groups: [] }, played: { games: {}, groups: [] } };
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: e }) });
    });
    await page.goto(`/stats?period=month&year=${TODAY.year}&month=${TODAY.month}`);
    await expect(page.locator('.ps-st-head')).toBeVisible();
    await expect(page.getByText('За этот период ничего нет')).toBeVisible();
    await expect(page.locator('.ps-st-bar')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined|Invalid/);
  });

  test('3 темы: нет горизонтального скролла, текст читаем (снимки при SHOTS_DIR)', async ({ page, context, baseURL }, info) => {
    await open(page, context, baseURL!);
    await expect(page.locator('.ps-st-bar')).toHaveCount(12);
    for (const t of ['night', 'graphite', 'ps5'] as const) {
      await theme(page, t);
      expect(await overflow(page), `overflow ${t} ${info.project.name}`).toBeLessThanOrEqual(0);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/stats-${info.project.name}-${t}.png`, fullPage: true });
    }
  });

  test('часы-столбцы: наведение показывает подсказку, Escape закрывает', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    const bar = page.locator('.ps-st-bar').nth(3);
    await bar.hover();
    await expect(page.getByRole('tooltip')).toContainText('Апр');
    await bar.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });

  test('часы-столбцы: клик/тап по столбцу оставляет подсказку открытой', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    const bar = page.locator('.ps-st-bar').nth(3);
    await bar.click();
    await expect(page.getByRole('tooltip')).toContainText('Апр');
    await page.mouse.move(0, 0); // уход курсора не закрывает закреплённую подсказку
    await expect(page.getByRole('tooltip')).toContainText('Апр');
    await page.locator('.ps-st-bar').nth(5).click(); // другой столбец переключает подсказку
    await expect(page.getByRole('tooltip')).toHaveCount(1);
    await expect(page.getByRole('tooltip')).toContainText('Июн');
    await page.locator('.ps-st-bar').nth(5).click(); // повторный тап закрывает
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await bar.click();
    await expect(page.getByRole('tooltip')).toContainText('Апр');
    await page.getByRole('heading', { name: 'Статистика' }).click(); // тап вне закрывает
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });
});
