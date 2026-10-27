// Фаза 6: экран /wrapped и режим историй на моках /api/wrapped. Форма ответа по контракту §11, не по реализации.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { signedSession } from './session';

const NOW_YEAR = Number(new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 4));
const Y_FULL = NOW_YEAR; // story, 8 слайдов
const Y_TROPHY = NOW_YEAR - 1; // нет часов, есть трофеи
const Y_EMPTY = NOW_YEAR - 2; // empty
const FIRST = `${NOW_YEAR}-03-04`;

const game = (id: number, title: string, status: 'completed' | 'dropped' | null = null) => ({
  id, title, coverUrl: null, platform: 'PS5', playSeconds: 101853, hours: 28.3, playCount: 19, lastPlayedAt: '2026-03-10T10:00:00.000Z',
  status, completedAt: status === 'completed' ? '2026-10-05T18:42:11.000Z' : null, droppedAt: status === 'dropped' ? '2026-08-01T10:00:00.000Z' : null,
  trophies: null, genres: [{ key: 'ACTION', label: 'Экшен' }],
});
const zeroC = { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };
const plat = { at: '2026-01-12T20:00:00.000Z', name: 'Платина', earnedRate: 4.3, rarity: 1, setName: 'Horizon', game: game(1, 'Horizon Forbidden West') };

function respond(year: number) {
  const full = year === Y_FULL;
  const trophy = year === Y_TROPHY;
  const base = {
    year,
    period: { from: `${year}-01-01`, to: `${year}-12-31`, fromUtc: `${year - 1}-12-31T21:00:00.000Z`, toUtc: `${year}-12-31T21:00:00.000Z` },
    years: [{ year: Y_FULL, hasData: true }, { year: Y_TROPHY, hasData: true }, { year: Y_EMPTY, hasData: false }],
    profile: { onlineId: 'Artem_PS' },
    firstSnapshotDate: FIRST,
    periodPartial: true,
  };
  if (!full && !trophy) {
    return {
      ...base, mode: 'empty', slides: ['empty'], emptyState: { syncStartedOn: FIRST },
      hours: { hasData: false, total: null, days: null, byMonth: Array(12).fill(null), topMonth: null },
      topGames: { hasData: false, items: [] },
      finished: { hasData: false, completed: { count: 0, items: [] }, dropped: { count: 0, items: [] }, busiestMonth: null },
      trophies: { hasData: false, counts: zeroC, platinum: { first: null, last: null, rarest: null } },
      genres: { hasData: false, items: [] },
      longestGame: { hasData: false, seconds: 0, hours: 0, playCount: 0, game: null },
    };
  }
  const counts = { platinum: 7, gold: 31, silver: 88, bronze: 240, total: 366 };
  const trophies = { hasData: true, counts, platinum: { first: plat, last: plat, rarest: plat } };
  const finished = {
    hasData: true,
    completed: { count: 12, items: [1, 2, 3, 4, 5].map((i) => ({ at: '2026-10-05T18:42:11.000Z', game: game(10 + i, `Пройденная ${i}`, 'completed') })) },
    dropped: { count: 3, items: [1, 2].map((i) => ({ at: '2026-08-01T10:00:00.000Z', game: game(20 + i, `Брошенная ${i}`, 'dropped') })) },
    busiestMonth: { month: 10, count: 4 },
  };
  const genres = { hasData: true, items: [{ key: 'ACTION', label: 'Экшен', value: 14.5 }, { key: 'RPG', label: 'Ролевые', value: 6 }, { key: 'OTHER', label: 'Другое', value: 2 }] };
  if (trophy) {
    return {
      ...base, mode: 'story', slides: ['start', 'finished', 'trophies', 'genres', 'final'], emptyState: null,
      hours: { hasData: false, total: null, days: null, byMonth: Array(12).fill(null), topMonth: null },
      topGames: { hasData: false, items: [] }, finished, trophies, genres,
      longestGame: { hasData: false, seconds: 0, hours: 0, playCount: 0, game: null },
    };
  }
  return {
    ...base, mode: 'story', slides: ['start', 'hours', 'topGames', 'finished', 'trophies', 'genres', 'longestGame', 'final'], emptyState: null,
    hours: { hasData: true, total: 412.4, days: 17.2, byMonth: Array(12).fill(null), topMonth: { month: 10, hours: 85 } },
    topGames: { hasData: true, items: [1, 2, 3, 4, 5].map((r) => ({ rank: r, seconds: 100000 / r, hours: 30 - r, game: game(r, `Игра ${r}`) })) },
    finished, trophies, genres,
    longestGame: { hasData: true, seconds: 101853, hours: 28.3, playCount: 19, game: game(1, 'Horizon Forbidden West') },
  };
}

type Ctl = { calls: URL[]; fail: number | null };
async function open(page: Page, context: BrowserContext, baseURL: string, url = '/wrapped'): Promise<Ctl> {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page);
  const ctl: Ctl = { calls: [], fail: null };
  await page.route(/\/api\/wrapped/, (r) => {
    const u = new URL(r.request().url());
    ctl.calls.push(u);
    if (ctl.fail) return r.fulfill({ status: ctl.fail, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'db_unavailable', message: 'x' } }) });
    const year = Number(u.searchParams.get('year') ?? NOW_YEAR);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: respond(year) }) });
  });
  if (url !== '/blank-never') await page.goto(url);
  return ctl;
}
async function theme(page: Page, t: 'night' | 'graphite' | 'activity') {
  await page.evaluate((v) => { if (v === 'night') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }, t);
}
/** Короткий автопереход вместо 7 с. */
const fast = (page: Page, ms = 700) => page.addStyleTag({ content: `:root{--dur-slide:${ms}ms !important}` });

const stage = (page: Page) => page.getByRole('dialog', { name: `Итоги ${Y_FULL}` });
const idx = async (page: Page) => Number(await page.locator('.ps-story__stage').getAttribute('data-index'));
const slideId = (page: Page) => page.locator('.ps-story__stage').getAttribute('data-slide');
async function watch(page: Page) {
  await page.getByRole('button', { name: 'Смотреть итоги' }).click();
  await expect(page.locator('.ps-story__stage')).toBeVisible();
}
async function tap(page: Page, side: 'left' | 'right') {
  const b = (await page.locator('.ps-story__stage').boundingBox())!;
  await page.mouse.click(b.x + (side === 'left' ? b.width * 0.1 : b.width * 0.8), b.y + b.height * 0.5);
}

test.describe('/wrapped: выбор года', () => {
  test('карточки годов, приглушённый год, год в URL, запрос с годом', async ({ page, context, baseURL }) => {
    const ctl = await open(page, context, baseURL!);
    await expect(page.getByRole('heading', { name: 'Итоги', level: 1 })).toBeVisible();
    const cards = page.locator('button.ps-wrapped-year');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(cards.nth(2)).toContainText('нет данных');
    await expect(cards.nth(0)).not.toContainText('нет данных');
    expect(ctl.calls[0].searchParams.has('year')).toBe(false);
    await cards.nth(1).click();
    await expect(page).toHaveURL(new RegExp(`year=${Y_TROPHY}`));
    await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => ctl.calls[ctl.calls.length - 1].searchParams.get('year')).toBe(String(Y_TROPHY));
    // мусор в URL не уходит в API
    await page.goto('/wrapped?year=abc');
    await expect(page.locator('button.ps-wrapped-year')).toHaveCount(3);
    expect(ctl.calls[ctl.calls.length - 1].searchParams.has('year')).toBe(false);
  });

  test('вкладка «Итоги» ведёт сюда и активна', async ({ page, context, baseURL }, info) => {
    await open(page, context, baseURL!, '/');
    const link = info.project.name === 'mobile'
      ? page.locator('a[href="/wrapped"]:visible').first()
      : page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Итоги' });
    await link.click();
    await expect(page).toHaveURL(/\/wrapped/);
    await expect(page.locator('a[href="/wrapped"][aria-current="page"]:visible').first()).toBeVisible();
  });

  test('503: ошибка и «Повторить»', async ({ page, context, baseURL }) => {
    const ctl = await open(page, context, baseURL!, '/blank-never');
    ctl.fail = 503;
    await page.goto('/wrapped');
    await expect(page.getByText('Что-то пошло не так')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Смотреть итоги' })).toHaveCount(0);
    ctl.fail = null;
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.locator('.ps-wrapped-year')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Смотреть итоги' })).toBeEnabled();
  });
});

test.describe('/wrapped: истории', () => {
  test('8 слайдов, сегментов столько же, тап вперёд и назад, границы', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await page.emulateMedia({ reducedMotion: 'reduce' }); // ручной режим: переходы только жестами
    await watch(page);
    await expect(stage(page)).toBeVisible();
    await expect(page.locator('.ps-story__seg')).toHaveCount(8);
    await expect(page.getByRole('heading', { name: `Твой ${Y_FULL} в играх` })).toBeVisible();
    await tap(page, 'left');
    expect(await idx(page)).toBe(0); // перед первым некуда
    await tap(page, 'right');
    expect(await idx(page)).toBe(1);
    await expect(page.locator('.ps-story__big')).toContainText('412,4');
    await expect(page.getByText('≈ 17 дней')).toBeVisible();
    await expect(page.locator('.ps-story__badge')).toContainText(`04.03.${NOW_YEAR}`);
    await tap(page, 'left');
    expect(await idx(page)).toBe(0);
    const order = ['start', 'hours', 'topGames', 'finished', 'trophies', 'genres', 'longestGame', 'final'];
    for (let i = 1; i < 8; i++) { await tap(page, 'right'); expect(await slideId(page)).toBe(order[i]); }
    await tap(page, 'right');
    expect(await idx(page)).toBe(7); // последний не закрывается
    await expect(page.getByRole('heading', { name: `До встречи в ${Y_FULL + 1}` })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(/NaN|undefined|null|Invalid/);
  });

  test('клавиши: стрелки, пробел, Esc, фокус возвращается на кнопку', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const btn = page.getByRole('button', { name: 'Смотреть итоги' });
    await btn.click();
    await expect(page.locator('.ps-story__stage')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    expect(await idx(page)).toBe(1);
    await page.keyboard.press('Space');
    expect(await idx(page)).toBe(2);
    await page.keyboard.press('ArrowLeft');
    expect(await idx(page)).toBe(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('.ps-story__stage')).toHaveCount(0);
    await expect(btn).toBeFocused();
  });

  test('focus trap: Tab не уходит за диалог', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await watch(page);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('.ps-story__stage'))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.ps-story__stage'))).toBe(true);
  });

  test('свайп: влево вперёд, вправо назад, короткий сдвиг игнорируется', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await watch(page);
    const b = (await page.locator('.ps-story__stage').boundingBox())!;
    const y = b.y + b.height / 2;
    const swipe = async (from: number, to: number) => {
      await page.mouse.move(b.x + from, y);
      await page.mouse.down();
      await page.mouse.move(b.x + to, y, { steps: 5 });
      await page.mouse.up();
    };
    await swipe(b.width * 0.8, b.width * 0.3);
    expect(await idx(page)).toBe(1);
    await swipe(b.width * 0.5, b.width * 0.5 + 30);
    expect(await idx(page)).toBe(1);
    await swipe(b.width * 0.3, b.width * 0.8);
    expect(await idx(page)).toBe(0);
  });

  test('автопереход, пауза удержанием, крестик закрывает', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await fast(page, 800);
    await watch(page);
    await expect.poll(() => idx(page), { timeout: 4000 }).toBeGreaterThanOrEqual(1);
    // удержание паузит: индекс не меняется дольше длительности слайда
    await expect.poll(() => idx(page)).toBeGreaterThanOrEqual(1);
    const b = (await page.locator('.ps-story__stage').boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.5);
    await page.mouse.down();
    await expect(page.locator('.ps-story__stage')).toHaveAttribute('data-paused', 'true');
    const before = await idx(page);
    await page.waitForTimeout(1800);
    expect(await idx(page)).toBe(before);
    await page.mouse.up(); // отпускание после удержания не листает
    expect(await idx(page)).toBe(before);
    await expect(page.locator('.ps-story__stage')).not.toHaveAttribute('data-paused', 'true');
    // дальше идёт сам до финала и там остаётся
    await expect.poll(() => slideId(page), { timeout: 12_000 }).toBe('final');
    await page.waitForTimeout(1500);
    expect(await slideId(page)).toBe('final');
    await expect(page.getByRole('button', { name: 'Пересмотреть' })).toBeVisible();
    await page.getByRole('button', { name: 'Пересмотреть' }).click();
    expect(await idx(page)).toBe(0);
    await page.getByRole('button', { name: 'Закрыть итоги' }).click();
    await expect(page.locator('.ps-story__stage')).toHaveCount(0);
  });

  test('prefers-reduced-motion: автоперехода нет, счётчик сразу со значением', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fast(page, 400);
    await watch(page);
    await page.waitForTimeout(1200);
    expect(await idx(page)).toBe(0);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.ps-story__big .ps-num [aria-hidden]')).toHaveText('412,4');
  });

  test('год «нет часов, но есть трофеи»: слайды 2, 3, 7 пропущены', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, `/wrapped?year=${Y_TROPHY}`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await watch(page);
    await expect(page.locator('.ps-story__seg')).toHaveCount(5);
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) { seen.push((await slideId(page))!); if (i < 4) await page.keyboard.press('ArrowRight'); }
    expect(seen).toEqual(['start', 'finished', 'trophies', 'genres', 'final']);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByText('Трофеев получено')).toBeVisible();
    await expect(page.getByText('366', { exact: true }).first()).toBeVisible();
  });

  test('год без данных: один слайд, дата синка, без автоперехода', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, `/wrapped?year=${Y_EMPTY}`);
    await fast(page, 300);
    await watch(page);
    await expect(page.locator('.ps-story__seg')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: `В ${Y_EMPTY} данных нет` })).toBeVisible();
    await expect(page.getByText(`Синк начался 04.03.${NOW_YEAR}`)).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByRole('heading', { name: `В ${Y_EMPTY} данных нет` })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('heading', { name: `В ${Y_EMPTY} данных нет` })).toBeVisible();
    await page.locator('.ps-story__body').getByRole('button', { name: 'Закрыть' }).click();
    await expect(page.locator('.ps-story__stage')).toHaveCount(0);
  });

  test('empty без даты синка: строки «Синк начался» нет', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/blank-never');
    await page.route(/\/api\/wrapped/, (r) => {
      const d = { ...respond(Y_EMPTY), emptyState: { syncStartedOn: null } };
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: d }) });
    });
    await page.goto(`/wrapped?year=${Y_EMPTY}`);
    await watch(page);
    await expect(page.getByText('Синк начался')).toHaveCount(0);
  });

  test('3 темы и размеры: слайд внутри экрана, нет горизонтального скролла', async ({ page, context, baseURL }, info) => {
    await open(page, context, baseURL!);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await watch(page);
    const vp = page.viewportSize()!;
    for (const t of ['night', 'graphite', 'activity'] as const) {
      await theme(page, t);
      for (let i = 0; i < 8; i++) {
        const b = (await page.locator('.ps-story__stage').boundingBox())!;
        expect(b.x, `${t} ${i}`).toBeGreaterThanOrEqual(-0.5);
        expect(b.x + b.width, `${t} ${i}`).toBeLessThanOrEqual(vp.width + 0.5);
        const over = await page.evaluate(() => {
          const body = document.querySelector('.ps-story__body')!;
          return body.scrollHeight - body.clientHeight;
        });
        expect(over, `${t} слайд ${i} ${info.project.name}`).toBeLessThanOrEqual(1);
        if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/wrapped-${info.project.name}-${t}-${i}.png` });
        await page.keyboard.press('ArrowRight');
      }
      for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowLeft');
    }
    if (info.project.name === 'mobile') {
      const b = (await page.locator('.ps-story__stage').boundingBox())!;
      expect(Math.round(b.width)).toBe(vp.width);
    } else {
      const b = (await page.locator('.ps-story__stage').boundingBox())!;
      expect(Math.round(b.width)).toBeGreaterThanOrEqual(360);
    }
  });
});
