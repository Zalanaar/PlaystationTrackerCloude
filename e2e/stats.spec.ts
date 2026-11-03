// QA Фазы 5: экран /stats на моках /api/stats (БД в e2e недоступна). Форма ответа по контракту §10, не по реализации.
import { test, expect, type Page } from '@playwright/test';
import { open, respond, TODAY, z, type Ctl } from './stats-mock';

const SHOTS = process.env.SHOTS_DIR;
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
    await expect(page.locator('.ps-card__title', { hasText: 'Игра Один' })).toHaveCount(1); // Фаза 18: только последний месяц с играми
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
    await page.getByRole('heading', { level: 2 }).first().click(); // тап вне закрывает (h1 на мобильном только для скринридеров)
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });
});
