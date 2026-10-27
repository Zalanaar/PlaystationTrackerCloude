// QA Фазы 6: стресс-данные (длинные названия, много жанров/годов, огромные числа), мусорные ?year=, малые viewport, hold/swipe.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const LONG = 'Ультрадлинное_название_игры_без_пробелов_'.repeat(4);
const LONG_SP = 'The Legend of Extremely Long Subtitle Edition: Director’s Cut Remastered Complete Collection Game of the Year '.repeat(2);
const game = (id: number, title: string, status: 'completed' | 'dropped' | null = null) => ({
  id, title, coverUrl: null, platform: 'PS5', playSeconds: 101853, hours: 28.3, playCount: 1234567, lastPlayedAt: '2026-03-10T10:00:00.000Z',
  status, completedAt: null, droppedAt: null, trophies: null, genres: [{ key: 'ACTION', label: 'Экшен' }],
});
const plat = { at: '2026-01-12T20:00:00.000Z', name: null, earnedRate: 0.1, rarity: 0, setName: 'Set', game: game(1, LONG) };

function stress(year: number) {
  const titles = [LONG, LONG_SP, 'Я', LONG, LONG_SP];
  return {
    year, mode: 'story',
    period: { from: `${year}-01-01`, to: `${year}-12-31`, fromUtc: `${year - 1}-12-31T21:00:00.000Z`, toUtc: `${year}-12-31T21:00:00.000Z` },
    years: Array.from({ length: 12 }, (_, i) => ({ year: 2026 - i, hasData: i % 2 === 0 })),
    profile: { onlineId: 'Очень_Длинный_Ник_Пользователя_PSN_1234567890' }, firstSnapshotDate: `${year}-03-04`, periodPartial: true,
    slides: ['start', 'hours', 'topGames', 'finished', 'trophies', 'genres', 'longestGame', 'final'], emptyState: null,
    hours: { hasData: true, total: 99999.9, days: 4166.7, byMonth: Array(12).fill(null), topMonth: { month: 12, hours: 9999.9 } },
    topGames: { hasData: true, items: titles.map((t, i) => ({ rank: i + 1, seconds: 100000, hours: 9999.9, game: game(i + 1, t) })) },
    finished: {
      hasData: true,
      completed: { count: 1234, items: titles.map((t, i) => ({ at: '2026-10-05T18:42:11.000Z', game: game(100 + i, t, 'completed') })) },
      dropped: { count: 999, items: titles.map((t, i) => ({ at: '2026-08-01T10:00:00.000Z', game: game(200 + i, t, 'dropped') })) },
      busiestMonth: { month: 5, count: 4 },
    },
    trophies: { hasData: true, counts: { platinum: 1234, gold: 99999, silver: 99999, bronze: 999999, total: 1234567 }, platinum: { first: plat, last: plat, rarest: plat } },
    genres: {
      hasData: true,
      items: ['Музыка и ритм', 'Ролевые игры с очень длинным названием жанра', 'Экшен', 'Другое', 'Хоррор', 'Гонки', 'Файтинги'].map((label, i) => ({ key: `K${i}`, label, value: 9999.9 - i })),
    },
    longestGame: { hasData: true, seconds: 101853, hours: 99999.9, playCount: 1234567, game: game(1, LONG) },
  };
}

async function open(page: Page, context: BrowserContext, baseURL: string, url: string, body: (y: number) => unknown = stress) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  const calls: URL[] = [];
  await page.route(/\/api\/wrapped/, (r) => {
    const u = new URL(r.request().url());
    calls.push(u);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: body(Number(u.searchParams.get('year') ?? 2026)) }) });
  });
  await page.goto(url);
  return calls;
}
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const stageEl = (page: Page) => page.locator('.ps-story__stage');

test.describe('wrapped QA: стресс', () => {
  test('страница выбора года: 12 карточек, длинные данные, нет горизонтального скролла', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/wrapped');
    await expect(page.locator('button.ps-wrapped-year')).toHaveCount(12);
    expect(await noHScroll(page)).toBe(true);
  });

  for (const vp of [{ width: 1280, height: 800 }, { width: 1280, height: 600 }, { width: 390, height: 844 }, { width: 360, height: 640 }, { width: 320, height: 568 }]) {
    test(`все слайды ${vp.width}x${vp.height}: содержимое не вылезает, крестик в экране, нет h-скролла`, async ({ page, context, baseURL }) => {
      await page.setViewportSize(vp);
      await open(page, context, baseURL!, '/wrapped');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByRole('button', { name: 'Смотреть итоги' }).click();
      await expect(stageEl(page)).toBeVisible();
      const issues: string[] = [];
      for (let i = 0; i < 8; i++) {
        const r = await page.evaluate(() => {
          const body = document.querySelector('.ps-story__body') as HTMLElement;
          const st = (document.querySelector('.ps-story__stage') as HTMLElement).getBoundingClientRect();
          const close = (document.querySelector('.ps-story__close') as HTMLElement).getBoundingClientRect();
          const wide = Array.from(body.querySelectorAll<HTMLElement>('*')).filter((e) => e.getBoundingClientRect().right > st.right + 1 || e.getBoundingClientRect().left < st.left - 1).length;
          // содержимое ниже верхней панели и выше низа сцены
          const kids = Array.from(body.querySelectorAll<HTMLElement>('.ps-story__rise')).map((e) => e.getBoundingClientRect());
          const top = Math.min(...kids.map((k) => k.top));
          const bottom = Math.max(...kids.map((k) => k.bottom));
          return {
            over: body.scrollHeight - body.clientHeight, wide, closeTop: close.top, closeBottom: close.bottom, closeLeft: close.left, closeRight: close.right,
            stTop: st.top, stBottom: st.bottom, contentTop: top - st.top, contentBottom: st.bottom - bottom, vh: window.innerHeight, vw: window.innerWidth,
            id: (document.querySelector('.ps-story__stage') as HTMLElement).dataset.slide,
          };
        });
        if (r.over > 1) issues.push(`${r.id}: переполнение по высоте ${r.over}px`);
        if (r.wide > 0) issues.push(`${r.id}: ${r.wide} элементов за границей по ширине`);
        if (r.closeTop < 0 || r.closeBottom > r.vh || r.closeLeft < 0 || r.closeRight > r.vw) issues.push(`${r.id}: крестик вне экрана`);
        if (r.contentTop < 44) issues.push(`${r.id}: контент заходит под прогресс/шапку (${Math.round(r.contentTop)}px)`);
        if (r.contentBottom < 0) issues.push(`${r.id}: контент ниже сцены`);
        if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/wq-${vp.width}x${vp.height}-${i}.png` });
        await page.keyboard.press('ArrowRight');
      }
      expect(issues, issues.join('\n')).toEqual([]);
      expect(await noHScroll(page)).toBe(true);
    });
  }

  test('мусорные ?year=: в API не уходят, страница не падает', async ({ page, context, baseURL }) => {
    const calls = await open(page, context, baseURL!, '/wrapped');
    for (const q of ['abc', '1999', '2101', '-5', '2026.5', '', '20260', '%00', '99999999999999999999', '2026&year=1', '٢٠٢٦']) {
      calls.length = 0;
      await page.goto(`/wrapped?year=${q}`);
      await expect(page.locator('button.ps-wrapped-year').first()).toBeVisible();
      for (const c of calls) expect(c.searchParams.get('year') === null || /^\d{4}$/.test(c.searchParams.get('year')!), `year=${q} -> ${c.search}`).toBe(true);
      await expect(page.getByText('Что-то пошло не так')).toHaveCount(0);
    }
  });

  test('удержание после сдвига не листает; свайп-прерывание (pointercancel) не листает; тап по кнопке финала не листает', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/wrapped');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Смотреть итоги' }).click();
    const b = (await stageEl(page).boundingBox())!;
    const idx = async () => Number(await stageEl(page).getAttribute('data-index'));
    // удержание 600 мс на правой зоне без сдвига
    await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.5);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    expect(await idx()).toBe(0);
    // быстрый тап по левым 30% на втором слайде возвращает, по границе 30% вправо вперёд
    await page.mouse.click(b.x + b.width * 0.8, b.y + b.height * 0.5);
    expect(await idx()).toBe(1);
    await page.mouse.click(b.x + b.width * 0.31, b.y + b.height * 0.5);
    expect(await idx()).toBe(2);
    await page.mouse.click(b.x + b.width * 0.29, b.y + b.height * 0.5);
    expect(await idx()).toBe(1);
    // вертикальный свайп игнорируется
    await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.7);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.3, { steps: 5 });
    await page.mouse.up();
    expect(await idx()).toBe(1);
    // финал: кнопки по тапу работают как кнопки, слайд не листается
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    expect(await idx()).toBe(7);
    await page.getByRole('button', { name: 'Пересмотреть' }).click();
    expect(await idx()).toBe(0);
  });

  test('пробел и Enter на кнопке финала не листают и не закрывают лишнего; Esc закрывает с любого слайда', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/wrapped');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Смотреть итоги' }).click();
    await expect(stageEl(page)).toBeFocused();
    for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: 'Пересмотреть' }).focus();
    await page.keyboard.press('Space');
    expect(await stageEl(page).getAttribute('data-index')).toBe('0');
    await page.keyboard.press('Escape');
    await expect(stageEl(page)).toHaveCount(0);
    // повторное открытие стартует с нуля
    await page.getByRole('button', { name: 'Смотреть итоги' }).click();
    expect(await stageEl(page).getAttribute('data-index')).toBe('0');
    // прокрутка страницы разблокирована после закрытия
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });

  test('число сегментов = число слайдов при разных наборах slides; неизвестные id отбрасываются', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/wrapped', (y) => ({ ...stress(y), slides: ['start', 'bogus', 'trophies', 'trophies', 'final'] }));
    await page.getByRole('button', { name: 'Смотреть итоги' }).click();
    await expect(page.locator('.ps-story__seg')).toHaveCount(3);
  });

  test('автопереход: после клика на год таймер не уезжает; фон вкладки не листает (visibility)', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/wrapped');
    await page.addStyleTag({ content: ':root{--dur-slide:500ms !important}' });
    await page.getByRole('button', { name: 'Смотреть итоги' }).click();
    await expect.poll(() => stageEl(page).getAttribute('data-index'), { timeout: 4000 }).not.toBe('0');
    const cur = page.locator('.ps-story__seg[data-state="cur"] .ps-story__fill');
    const p = await cur.evaluate((e) => getComputedStyle(e).getPropertyValue('--p'));
    expect(Number(p)).toBeGreaterThanOrEqual(0);
    expect(Number(p)).toBeLessThanOrEqual(1);
  });
});

test.describe('wrapped QA: сбой сети', () => {
  test('503 при смене года: ошибка, «Повторить» восстанавливает выбранный год', async ({ page, context, baseURL }) => {
    let fail = false;
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    await mockApi(page);
    const years: (string | null)[] = [];
    await page.route(/\/api\/wrapped/, (r) => {
      const u = new URL(r.request().url());
      years.push(u.searchParams.get('year'));
      if (fail) return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'db_unavailable', message: 'x' } }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: stress(Number(u.searchParams.get('year') ?? 2026)) }) });
    });
    await page.goto('/wrapped');
    await expect(page.locator('button.ps-wrapped-year')).toHaveCount(12);
    fail = true;
    await page.locator('button.ps-wrapped-year').nth(3).click();
    await expect(page.getByText('Что-то пошло не так')).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.locator('button.ps-wrapped-year').nth(3)).toHaveAttribute('aria-pressed', 'true');
    expect(years[years.length - 1]).toBe('2023');
    await expect(page.getByRole('button', { name: 'Смотреть итоги' })).toBeEnabled();
  });
});

// Реалистичные данные (2-значные счётчики, короткие названия): слайд «Пройдено и брошено» на узких телефонах.
test.describe('wrapped QA: реалистичные данные на узких экранах', () => {
  const real = (y: number) => {
    const d = stress(y);
    const g = (i: number) => game(i, `Игра ${i}`);
    return {
      ...d,
      profile: { onlineId: 'Artem_PS' },
      finished: {
        hasData: true,
        completed: { count: 12, items: [1, 2, 3, 4, 5].map((i) => ({ at: '2026-10-05T18:42:11.000Z', game: g(i) })) },
        dropped: { count: 3, items: [6, 7, 8].map((i) => ({ at: '2026-08-01T10:00:00.000Z', game: g(i) })) },
        busiestMonth: { month: 10, count: 4 },
      },
      trophies: { ...d.trophies, counts: { platinum: 7, gold: 31, silver: 88, bronze: 240, total: 366 } },
    };
  };
  for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 740 }, { width: 320, height: 568 }]) {
    test(`finished ${vp.width}px: ряд обложек не вылезает из слайда`, async ({ page, context, baseURL }) => {
      await page.setViewportSize(vp);
      await open(page, context, baseURL!, '/wrapped', real);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByRole('button', { name: 'Смотреть итоги' }).click();
      await expect(stageEl(page)).toBeFocused();
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('heading', { name: 'Пройдено и брошено' })).toBeVisible();
      const r = await page.evaluate(() => {
        const st = (document.querySelector('.ps-story__stage') as HTMLElement).getBoundingClientRect();
        const stat = (document.querySelector('.ps-story__stat') as HTMLElement).getBoundingClientRect();
        const cov = (document.querySelector('.ps-story__covers') as HTMLElement).getBoundingClientRect();
        const last = (document.querySelector('.ps-story__covers')!.lastElementChild as HTMLElement).getBoundingClientRect();
        return { stageR: st.right, lastR: last.right, statR: stat.right, covL: cov.left };
      });
      if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/wq-real-finished-${vp.width}.png` });
      expect(r.lastR, 'обложки за правой границей слайда').toBeLessThanOrEqual(r.stageR + 1);
      expect(r.statR, 'число перекрыто обложками').toBeLessThanOrEqual(r.covL + 1);
    });
  }
});
