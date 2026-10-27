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

type Opts = { empty?: boolean; hoursNull?: boolean };
/** Ответ по контракту §10.1 для разобранных параметров. */
function respond(u: URL, o: Opts = {}) {
  const type = u.searchParams.get('period') === 'month' ? 'month' : 'year';
  const year = Number(u.searchParams.get('year') ?? TODAY.year);
  const month = type === 'month' ? Number(u.searchParams.get('month')) : null;
  const last = month ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 31;
  const p = (n: number) => String(n).padStart(2, '0');
  const has = !o.empty && year >= TODAY.year - 1;
  const byMonth = Array.from({ length: 12 }, (_, i) => (year < TODAY.year ? null : i < 0 || i + 1 > TODAY.month ? null : i === 0 ? null : 10 + i));
  return {
    period: {
      type, year, month, from: `${year}-${p(month ?? 1)}-01`, to: `${year}-${p(month ?? 12)}-${p(last)}`,
      fromUtc: new Date(Date.UTC(year, (month ?? 1) - 1, 1) - 3 * 3600_000).toISOString(), toUtc: new Date(Date.UTC(year, (month ?? 12) - 1, last + 1) - 3 * 3600_000).toISOString(),
    },
    years: [TODAY.year, TODAY.year - 1],
    header: { completed: has ? 1 : 0, dropped: has ? 1 : 0, hours: o.hoursNull || year < TODAY.year ? null : has ? 123.4 : 0, platinum: has ? 2 : 0 },
    hours: { byMonth: has ? byMonth : byMonth.map(() => null), firstSnapshotDate: FIRST, periodPartial: year <= TODAY.year && (month ?? 1) <= 1 || year < TODAY.year },
    genres: has ? { hasData: true, items: [{ key: 'ACTION', label: 'Экшен', value: 14.5 }, { key: 'OTHER', label: 'Другое', value: 3 }] } : { hasData: false, items: [] },
    trophies: {
      counts: has ? { platinum: 2, gold: 3, silver: 4, bronze: 5, total: 14 } : z,
      byMonth: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...(has && i === 2 ? { platinum: 2, gold: 3, silver: 4, bronze: 5, total: 14 } : z) })),
    },
    finished: has
      ? { groups: [{ month: `${year}-03`, year, monthNumber: 3, items: [{ kind: 'completed', at: '2026-03-10T10:00:00.000Z', game: game(1, 'Игра Один', 'completed') }, { kind: 'dropped', at: '2026-03-12T10:00:00.000Z', game: game(2, 'Игра Два', 'dropped') }] }] }
      : { groups: [] },
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
async function theme(page: Page, t: 'night' | 'graphite' | 'activity') {
  await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const last = (c: Ctl) => c.calls[c.calls.length - 1];

test.describe('/stats', () => {
  test('год: шапка, 12 столбцов часов, плашка про первый синк, жанры, трофеи, завершённые', async ({ page, context, baseURL }) => {
    const ctl = await open(page, context, baseURL!);
    await expect(page.getByRole('heading', { name: 'Часы по месяцам' })).toBeVisible();
    expect(last(ctl).searchParams.get('period')).toBe('year');
    await expect(page.locator('.ps-st-bar')).toHaveCount(12);
    await expect(page.locator('.ps-st-bar[data-nodata]').first()).toBeVisible(); // null-месяцы заштрихованы
    await expect(page.locator('.ps-st-head')).toContainText('123,4 ч');
    await expect(page.getByRole('note')).toContainText(`15.01.${TODAY.year}`);
    await expect(page.getByRole('heading', { name: 'Жанры' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Трофеи' })).toBeVisible();
    await expect(page.locator('.ps-card__title', { hasText: 'Игра Один' })).toHaveCount(1);
    await expect(page.locator('.ps-card__title', { hasText: 'Игра Два' })).toHaveCount(1);
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined|null|Invalid/);
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

  test('пустой МЕСЯЦ внутри года с данными: что видит пользователь (контракт: byMonth всегда год)', async ({ page, context, baseURL }) => {
    const ctl = await open(page, context, baseURL!, '/blank-never');
    await page.route(/\/api\/stats\?/, (r) => {
      const d = respond(new URL(r.request().url()));
      const e = { ...d, header: { completed: 0, dropped: 0, hours: 0, platinum: 0 }, genres: { hasData: false, items: [] }, trophies: { counts: z, byMonth: d.trophies.byMonth.map((m) => ({ ...m, ...z })) }, finished: { groups: [] } };
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: e }) });
    });
    await page.goto(`/stats?period=month&year=${TODAY.year}&month=${TODAY.month}`);
    await expect(page.locator('.ps-st-head')).toBeVisible();
    const empty = await page.getByText('За этот период ничего нет').count();
    console.log('EMPTY MONTH IN ACTIVE YEAR: empty-state =', empty, 'ctl calls =', ctl.calls.length);
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined|Invalid/);
  });

  test('3 темы: нет горизонтального скролла, текст читаем (снимки при SHOTS_DIR)', async ({ page, context, baseURL }, info) => {
    await open(page, context, baseURL!);
    await expect(page.locator('.ps-st-bar')).toHaveCount(12);
    for (const t of ['night', 'graphite', 'activity'] as const) {
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

  // BUG-S2: onMouseEnter открывает подсказку, следующий же click её закрывает (toggle): на тач-экране и при клике мышью подсказки нет.
  test('часы-столбцы: клик/тап по столбцу оставляет подсказку открытой', async ({ page, context, baseURL }) => {
    test.fail(true, 'BUG-S2: click после hover закрывает подсказку');
    await open(page, context, baseURL!);
    await page.locator('.ps-st-bar').nth(3).click();
    await expect(page.getByRole('tooltip')).toContainText('Апр');
  });
});
