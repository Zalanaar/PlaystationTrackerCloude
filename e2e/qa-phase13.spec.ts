// QA Фазы 13: шапка 768-1023 на всех экранах (регрессия), a11y сегментов, гонки при быстрой смене time, 7 тем.
import { test, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { mockApi } from './collection-mock';
import { baseState, mockRoadmap } from './roadmap-mock';
import { signedSession } from './session';
import { THEMES, THEME_STORAGE_KEY } from '../src/ui/tokens';

const mk = (id: number, name: string) => ({
  game: { id, name, imageUrl: null, bannerUrl: null, genres: ['ACTION'], hours: 10, hoursSource: 'hltb' },
  score: 3.1,
  signals: [{ key: 'genre_affinity', label: 'Любимый жанр', contribution: 2.4 }, { key: 'dropped_genre_penalty', label: 'Бросаешь', contribution: -1 }],
  reason: { text: `Причина ${name}`, source: 'template' },
});
type Cfg = { delay: Record<string, number>; fail: Record<string, number>; calls: string[] };

async function open(page: Page, context: BrowserContext, baseURL: string, path = '/recommend', cfg: Cfg = { delay: {}, fail: {}, calls: [] }, theme?: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  if (theme) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [THEME_STORAGE_KEY, theme]);
  await mockApi(page, []);
  await mockRoadmap(page, baseState());
  await page.route(/\/api\/recommend(\?.*)?$/, async (r: Route) => {
    const q = new URL(r.request().url()).searchParams.get('time') ?? 'any';
    cfg.calls.push(q);
    if (cfg.delay[q]) await new Promise((x) => setTimeout(x, cfg.delay[q]));
    if (cfg.fail[q]) return r.fulfill({ status: cfg.fail[q], contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'internal', message: 'x' } }) });
    const names = [`Игра-${q}-1`, `Игра-${q}-2`, `Игра-${q}-3`];
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { items: names.map((n, i) => mk(i + 1, n)), meta: { llm: 'disabled', candidates: 9, time: q } } }) });
  });
  await page.goto(path);
  return cfg;
}
const noH = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const names = (page: Page) => page.locator('.ps-rec__name').allTextContents();

test.describe('QA 13: шапка 768-1023 на всех экранах (4 вкладки, Фаза 18)', () => {
  for (const width of [768, 800, 820, 900, 960, 1023]) {
    for (const path of ['/recommend', '/', '/stats', '/backlog', '/roadmap', '/wrapped']) {
      test(`${width}px ${path}: элементы шапки внутри окна, подписи не обрезаны`, async ({ page, context, baseURL, isMobile }) => {
        test.skip(isMobile, 'размер задаётся вручную');
        await page.setViewportSize({ width, height: 800 });
        await open(page, context, baseURL as string, path);
        await page.locator('header').first().waitFor();
        expect(await noH(page)).toBe(true);
        const bad = await page.evaluate((w) => {
          const h = document.querySelector('header') as HTMLElement;
          return Array.from(h.querySelectorAll<HTMLElement>('a,button')).filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && (r.right > w + 0.5 || r.left < -0.5 || e.scrollWidth > e.clientWidth + 1);
          }).map((e) => `${e.textContent?.trim() || e.getAttribute('aria-label')} r=${Math.round(e.getBoundingClientRect().right)} sw=${e.scrollWidth} cw=${e.clientWidth}`);
        }, width);
        expect(bad).toEqual([]);
        // 4 пункта навигации (Фаза 18), высота шапки одна строка (нет переноса вкладок)
        const nav = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll<HTMLElement>('header .ps-nav-item'));
          return { n: links.length, tops: new Set(links.map((l) => Math.round(l.getBoundingClientRect().top))).size };
        });
        expect(nav).toEqual({ n: 4, tops: 1 });
      });
    }
  }
});

test.describe('QA 13: a11y сегментов времени', () => {
  test('radiogroup: roving tabindex, aria-checked, стрелки, Home/End, фокус следует за выбором, Tab выходит из группы', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'клавиатура');
    await open(page, context, baseURL as string);
    await expect(page.locator('.ps-rec__name')).toHaveCount(3);
    const group = page.getByRole('radiogroup', { name: 'Сколько времени есть' });
    const radios = group.getByRole('radio');
    await expect(radios).toHaveCount(4);
    expect(await radios.evaluateAll((els) => els.map((e) => [e.getAttribute('aria-checked'), e.getAttribute('tabindex')]))).toEqual([['true', '0'], ['false', '-1'], ['false', '-1'], ['false', '-1']]);
    await radios.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(radios.nth(1)).toBeFocused();
    await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(page).toHaveURL(/time=short/);
    await page.keyboard.press('End');
    await expect(radios.nth(3)).toBeFocused();
    await expect(page).toHaveURL(/time=long/);
    await page.keyboard.press('ArrowRight'); // обход по кругу
    await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(page).toHaveURL(/\/recommend$/);
    await page.keyboard.press('ArrowLeft');
    await expect(radios.nth(3)).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Home');
    await expect(radios.nth(0)).toBeFocused();
    // у каждого сегмента доступное имя содержит подсказку; ровно один checked
    expect(await radios.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Любое, без ограничения', 'Короткая, до 8 ч', 'Средняя, 8–30 ч', 'Долгая, более 30 ч']);
    // history: смена сегмента не плодит шаги (router.replace)
    const len = await page.evaluate(() => history.length);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => history.length)).toBe(len);
  });
  test('карточки: список ol, aria-label с позицией, раскрывашка связана aria-controls', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await expect(page.locator('ol.ps-rec-list > li')).toHaveCount(3);
    await expect(page.locator('ol.ps-rec-list > li').first()).toHaveAttribute('aria-label', /^Рекомендация 1 из 3: /);
    const btn = page.getByRole('button', { name: /Почему эта игра/ }).first();
    const id = await btn.getAttribute('aria-controls');
    expect(id).toBeTruthy();
    await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
  });
});

test.describe('QA 13: гонки при смене time', () => {
  test('медленный старый ответ приходит позже нового: остаётся результат последнего выбора', async ({ page, context, baseURL }) => {
    const cfg = await open(page, context, baseURL as string, '/recommend', { delay: { short: 900, medium: 100 }, fail: {}, calls: [] });
    await expect(page.locator('.ps-rec__name').first()).toHaveText('Игра-any-1');
    await page.getByRole('radio', { name: /^Короткая/ }).click();
    await page.getByRole('radio', { name: /^Средняя/ }).click();
    await expect(page.locator('.ps-rec__name').first()).toHaveText('Игра-medium-1');
    await page.waitForTimeout(1200); // старый short дошёл
    expect(await names(page)).toEqual(['Игра-medium-1', 'Игра-medium-2', 'Игра-medium-3']);
    await expect(page.getByRole('radio', { name: /^Средняя/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Подбираю…')).toBeHidden();
    expect(cfg.calls).toEqual(['any', 'short', 'medium']);
  });
  test('упавший старый запрос не показывает баннер ошибки, если последний успешен', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string, '/recommend', { delay: { short: 700 }, fail: { short: 500 }, calls: [] });
    await expect(page.locator('.ps-rec__name')).toHaveCount(3);
    await page.getByRole('radio', { name: /^Короткая/ }).click();
    await page.getByRole('radio', { name: /^Долгая/ }).click();
    await expect(page.locator('.ps-rec__name').first()).toHaveText('Игра-long-1');
    await page.waitForTimeout(1000);
    await expect(page.getByText('Не удалось обновить подсказки')).toHaveCount(0);
    expect((await names(page))[0]).toBe('Игра-long-1');
  });
  test('упал последний запрос: баннер и прежние карточки, повтор работает с актуальным time', async ({ page, context, baseURL }) => {
    const cfg: Cfg = { delay: {}, fail: { short: 500 }, calls: [] };
    await open(page, context, baseURL as string, '/recommend', cfg);
    await expect(page.locator('.ps-rec__name')).toHaveCount(3);
    await page.getByRole('radio', { name: /^Короткая/ }).click();
    await expect(page.getByText('Не удалось обновить подсказки. Показаны прежние.')).toBeVisible();
    expect((await names(page))[0]).toBe('Игра-any-1');
    cfg.fail = {};
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.locator('.ps-rec__name').first()).toHaveText('Игра-short-1');
    expect(cfg.calls.at(-1)).toBe('short');
  });
  test('20 быстрых переключений: итог соответствует последнему выбранному сегменту', async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, 'клавиатура');
    await open(page, context, baseURL as string, '/recommend', { delay: { short: 300, medium: 50, long: 200 }, fail: {}, calls: [] });
    await expect(page.locator('.ps-rec__name')).toHaveCount(3);
    const order = ['Короткая', 'Средняя', 'Долгая', 'Любое'];
    let last = 'Любое';
    for (let i = 0; i < 20; i++) {
      last = order[i % 4];
      await page.getByRole('radio', { name: new RegExp(`^${last}`) }).click();
    }
    await page.waitForTimeout(1200);
    await expect(page.getByRole('radio', { name: new RegExp(`^${last}`) })).toHaveAttribute('aria-checked', 'true');
    const want = { Любое: 'any', Короткая: 'short', Средняя: 'medium', Долгая: 'long' }[last];
    expect((await names(page))[0]).toBe(`Игра-${want}-1`);
    await expect(page.getByText('Подбираю…')).toBeHidden();
  });
});

test.describe('QA 13: темы и мобильные', () => {
  for (const th of THEMES) {
    test(`тема ${th.id}: экран без горизонтального скролла, раскрывашка читаема`, async ({ page, context, baseURL }) => {
      await open(page, context, baseURL as string, '/recommend', undefined, th.id);
      await expect(page.locator('.ps-rec__name')).toHaveCount(3);
      await page.getByRole('button', { name: /Почему эта игра/ }).first().click();
      expect(await noH(page)).toBe(true);
      await expect(page.locator('.ps-rec__sig').first()).toBeVisible();
    });
  }
  test('в стилях карточки нет △ и ✕ (нет текстовых фигур статусов вне пустого состояния)', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await expect(page.locator('.ps-rec__name')).toHaveCount(3);
    const txt = await page.locator('ol.ps-rec-list').innerText();
    expect(txt).not.toMatch(/[△✕✗×]/);
  });
  test('мобильные: цели нажатия кнопок карточки и сегментов не меньше 44px', async ({ page, context, baseURL, isMobile }) => {
    test.skip(!isMobile, 'только мобильный профиль');
    await open(page, context, baseURL as string);
    await expect(page.locator('.ps-rec__name')).toHaveCount(3);
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.ps-rec__actions button, .ps-rec-seg button, .ps-rec__whybtn'))
        .map((e) => [e.textContent?.trim().slice(0, 20), Math.round(e.getBoundingClientRect().height)] as const)
        .filter(([, h]) => h < 44));
    expect(small).toEqual([]);
  });
});
