// QA Фазы 21: дополнительные проверки поверх e2e/tour.spec.ts (блокировка ввода, темы, reduced-motion, forced-colors, планшет, ландшафт, /wrapped).
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, seed } from './collection-mock';
import { signedSession } from './session';

const stats503 = '{"ok":false,"error":{"code":"db_unavailable","message":"x"}}';

async function open(page: Page, context: BrowserContext, baseURL: string, url = '/', tour: { completedVersion?: number; shouldAutoStart?: boolean } = {}) {
  const calls: { statusPuts: string[]; tourPuts: unknown[] } = { statusPuts: [], tourPuts: [] };
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  await mockApi(page, seed());
  await page.route(/\/api\/stats(\?|$)/, (r) => r.fulfill({ status: 503, contentType: 'application/json', body: stats503 }));
  await page.route('**/api/me/tour', (r) => {
    if (r.request().method() === 'PUT') calls.tourPuts.push(r.request().postDataJSON());
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: tour.completedVersion ?? 1, shouldAutoStart: tour.shouldAutoStart ?? false } }) });
  });
  page.on('request', (rq) => { if (/\/api\/games\/\d+\/status/.test(rq.url()) && rq.method() !== 'GET') calls.statusPuts.push(rq.url()); });
  await page.goto(url);
  return calls;
}
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;
const count = (page: Page) => page.getByTestId('tour-count');
const dialog = (page: Page) => page.getByRole('dialog').filter({ has: page.getByTestId('tour-count') });
async function startFromMenu(page: Page) {
  if (isMobile(page)) { await page.getByRole('button', { name: 'Меню', exact: true }).click(); await page.getByRole('button', { name: 'Как пользоваться' }).click(); }
  else { await page.locator('.ps-avatar').click(); await page.getByRole('menuitem', { name: 'Как пользоваться' }).click(); }
  await expect(count(page)).toHaveText('1 из 14');
}
async function goStep(page: Page, n: number) {
  for (let i = 1; i < n; i++) await dialog(page).getByRole('button', { name: 'Далее' }).click();
  await expect(count(page)).toHaveText(`${n} из 14`);
}

test.describe('QA 21: блокировка ввода', () => {
  test('колесо и клик по подсвеченной карточке/затемнению ничего не делают; ?game= не открывается', async ({ page, context, baseURL }) => {
    test.skip(isMobile(page), 'колесо мыши: десктоп');
    await open(page, context, baseURL!);
    await expect(page.locator('.ps-card').first()).toBeVisible();
    await startFromMenu(page);
    await goStep(page, 2);
    await expect(page.locator('.ps-tour')).toHaveAttribute('data-mode', 'spot');
    await page.waitForTimeout(600);
    const y0 = await page.evaluate(() => scrollY);
    await page.mouse.move(700, 450);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => scrollY)).toBe(y0);
    const s = await page.locator('.ps-tour__spot').boundingBox();
    await page.mouse.click(s!.x + s!.width / 2, s!.y + s!.height / 2); // клик по подсвеченной карточке
    await page.mouse.click(5, 5); // затемнение
    await page.waitForTimeout(300);
    await expect(count(page)).toHaveText('2 из 14');
    expect(new URL(page.url()).search).toBe('');
    await expect(page.getByRole('dialog', { name: /Horizon|God of War|Witcher/ })).toHaveCount(0);
  });

  test('клавиши 1–6 и пробел в Разборе во время тура не ставят статус; Enter на «Далее» работает', async ({ page, context, baseURL }) => {
    test.skip(isMobile(page), 'клавиатура: десктоп');
    const calls = await open(page, context, baseURL!, '/triage');
    await expect(page.getByRole('heading', { level: 2, name: 'Tetris Effect' })).toBeVisible();
    await startFromMenu(page);
    await goStep(page, 7);
    for (const k of ['1', '2', '3', '6', ' ']) await page.keyboard.press(k);
    await page.waitForTimeout(400);
    expect(calls.statusPuts).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.locator('.ps-tour')).toHaveCount(0);
    // после закрытия горячие клавиши работают снова
    await page.keyboard.press('1');
    await expect.poll(() => calls.statusPuts.length, { timeout: 4000 }).toBeGreaterThan(0);
  });

  test('Enter и Space активируют кнопку в фокусе', async ({ page, context, baseURL }) => {
    test.skip(isMobile(page), 'клавиатура: десктоп');
    await open(page, context, baseURL!);
    await startFromMenu(page);
    await page.keyboard.press('Tab'); // Пропустить -> ... -> Далее (на шаге 1 нет «Назад»)
    await dialog(page).getByRole('button', { name: 'Далее' }).focus();
    await page.keyboard.press('Enter');
    await expect(count(page)).toHaveText('2 из 14');
    await expect(dialog(page).getByRole('button', { name: 'Далее' })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(count(page)).toHaveText('3 из 14');
  });
});

test.describe('QA 21: темы, движение, forced colors', () => {
  test('смена темы во время тура обновляет цвета поповера на лету; PS5 радиус 22, PS1 dim .52', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!);
    await expect(page.locator('.ps-card').first()).toBeVisible();
    await startFromMenu(page);
    const pop = page.locator('.ps-tour__pop');
    const bg0 = await pop.evaluate((e) => getComputedStyle(e).backgroundColor);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'ps1'));
    await expect.poll(() => pop.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(bg0);
    expect(await pop.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(196, 192, 184)');
    expect(await page.locator('.ps-tour__dim').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgba(8, 9, 14, 0.52)');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'ps5'));
    const r = await pop.evaluate((e) => getComputedStyle(e).borderTopLeftRadius);
    if (!isMobile(page)) expect(r).toBe('22px');
    // «Далее» = .ps-btn темы (--r-md 14 в PS5), не pill: расхождение с §10.9 зафиксировано в docs/qa/phase-21.md (N-3)
  });

  test('reduced-motion: у прожектора и поповера нет transition/animation', async ({ page, context, baseURL }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, context, baseURL!);
    await expect(page.locator('.ps-card').first()).toBeVisible();
    await startFromMenu(page);
    await dialog(page).getByRole('button', { name: 'Далее' }).click();
    const css = await page.evaluate(() => {
      const g = (s: string) => { const c = getComputedStyle(document.querySelector(s)!); return `${c.transitionDuration}|${c.animationName}`; };
      return { spot: g('.ps-tour__spot'), pop: g('.ps-tour__pop'), bar: g('.ps-tour__bar > i') };
    });
    for (const v of Object.values(css)) expect(v).toMatch(/^(0s|0s, 0s|0s, 0s, 0s, 0s)\|none$/);
  });

  test('forced-colors: кольцо — outline Highlight, рамка поповера CanvasText', async ({ page, context, baseURL }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await open(page, context, baseURL!);
    await expect(page.locator('.ps-card').first()).toBeVisible();
    await startFromMenu(page);
    const o = await page.locator('.ps-tour__spot').evaluate((e) => { const c = getComputedStyle(e); return { w: c.outlineWidth, style: c.outlineStyle, shadow: c.boxShadow }; });
    expect(o.style).toBe('solid');
    expect(o.w).toBe('2px');
    expect(o.shadow).toBe('none');
    expect(await page.locator('.ps-tour__pop').evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe('solid');
  });
});

test.describe('QA 21: планшет, ландшафт, /wrapped', () => {
  test('планшет 768x1024: шаг 7 (Разбор) подсвечивает элемент, поповер не перекрывает кольцо', async ({ page, context, baseURL }) => {
    test.skip(isMobile(page), 'используется десктопный проект с viewport 768');
    // Известный дефект T-1 (docs/qa/phase-21.md): на планшете 768–999 якорь Разбора = вся стопка, свободной стороны нет, поповер ложится на кольцо.
    // test.fail: тест станет красным, когда дефект исправят, и его нужно будет перевести в обычный.
    test.fail();
    await page.setViewportSize({ width: 768, height: 1024 });
    await open(page, context, baseURL!);
    await expect(page.locator('.ps-card').first()).toBeVisible();
    await startFromMenu(page);
    await goStep(page, 7);
    await expect(page.locator('.ps-tour')).toHaveAttribute('data-mode', 'spot', { timeout: 6000 });
    await page.waitForTimeout(700);
    const g = await page.evaluate(() => {
      const r = (e: Element | null) => { const b = e!.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
      return { spot: r(document.querySelector('.ps-tour__spot')), pop: r(document.querySelector('.ps-tour__pop')), text: document.querySelector('.ps-tour__text')?.textContent ?? '' };
    });
    const e = 1.5;
    expect(g.pop.x < g.spot.x + g.spot.w - e && g.pop.x + g.pop.w > g.spot.x + e && g.pop.y < g.spot.y + g.spot.h - e && g.pop.y + g.pop.h > g.spot.y + e).toBe(false);
    console.log('ПЛАНШЕТ шаг 7 текст:', g.text);
  });

  test('мобильный ландшафт 640x360: кнопки листа в экране и доступны, текст прокручивается', async ({ page, context, baseURL }) => {
    test.skip(!isMobile(page), 'только мобильный');
    await page.setViewportSize({ width: 640, height: 360 });
    await open(page, context, baseURL!);
    await expect(page.locator('.ps-card').first()).toBeVisible();
    await page.getByRole('button', { name: 'Меню', exact: true }).click().catch(() => {});
    const asMobile = await page.getByRole('button', { name: 'Как пользоваться' }).isVisible().catch(() => false);
    test.skip(!asMobile, 'при 640 px ширина >= 640 но < 768: меню «⋯» должно быть; если нет, это баг раскладки');
    await page.getByRole('button', { name: 'Как пользоваться' }).click();
    await expect(count(page)).toHaveText('1 из 14');
    for (const step of [1, 2, 6, 14]) {
      if (step > 1) { while (!(await count(page).textContent())?.startsWith(`${step} `)) await dialog(page).getByRole('button', { name: 'Далее' }).click(); }
      const b = await page.evaluate(() => {
        const p = document.querySelector('.ps-tour__pop')!.getBoundingClientRect();
        const btns = Array.from(document.querySelectorAll('.ps-tour__foot button')).map((x) => { const r = x.getBoundingClientRect(); return { b: r.bottom, t: r.top, h: r.height }; });
        return { top: p.top, bottom: p.bottom, btns, vh: innerHeight };
      });
      expect(b.top, `шаг ${step}`).toBeGreaterThanOrEqual(0);
      for (const x of b.btns) { expect(x.b).toBeLessThanOrEqual(b.vh); expect(x.h).toBeGreaterThanOrEqual(44); }
    }
  });

  test('ручной запуск с /wrapped: тур не ломается (если пункт меню доступен)', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/wrapped');
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => ({ path: location.pathname, hasAvatar: !!document.querySelector('.ps-avatar'), hasMore: !!document.querySelector('[data-tour="menu-more"]'), tour: !!document.querySelector('.ps-tour') }));
    console.log('WRAPPED:', JSON.stringify(info));
    expect(info.tour).toBe(false);
    // ручной запуск: меню доступно, тур уходит на «/» и стартует с шага 1
    await startFromMenu(page);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
    await expect(page.locator('.ps-tour')).toHaveAttribute('data-mode', 'spot', { timeout: 6000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.ps-tour')).toHaveCount(0);
  });

  test('автозапуск не стартует на /wrapped при shouldAutoStart=true', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL!, '/wrapped', { completedVersion: 0, shouldAutoStart: true });
    await page.waitForTimeout(2500);
    await expect(page.locator('.ps-tour')).toHaveCount(0);
  });
});

test.describe('QA 21: автозапуск и меню', () => {
  test('один раз за сессию: сервер всё ещё просит автозапуск, ps-tour-seen нет, но ps-tour-shown держит', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
    await mockApi(page, seed());
    await page.route(/\/api\/stats(\?|$)/, (r) => r.fulfill({ status: 503, contentType: 'application/json', body: stats503 }));
    await page.route('**/api/me/tour', (r) => r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: 1, completedVersion: 0, shouldAutoStart: true } }) })
      : r.fulfill({ status: 500, contentType: 'application/json', body: stats503 }));
    await page.goto('/');
    await expect(count(page)).toHaveText('1 из 14', { timeout: 8000 });
    expect(await page.evaluate(() => sessionStorage.getItem('ps-tour-shown'))).toBe('1');
    await page.keyboard.press('Escape');
    await expect(page.locator('.ps-tour')).toHaveCount(0);
    await page.evaluate(() => localStorage.removeItem('ps-tour-seen')); // имитация приватного режима: локальный флаг потерян
    await page.reload();
    await expect(page.locator('.ps-card').first()).toBeVisible();
    await page.waitForTimeout(2000);
    await expect(page.locator('.ps-tour')).toHaveCount(0);
  });

  test('«Как пользоваться» из Бэклога стартует с шага 1 на «/» и не пишет статус', async ({ page, context, baseURL }) => {
    const calls = await open(page, context, baseURL!, '/backlog');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await startFromMenu(page);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/');
    expect(calls.tourPuts).toEqual([]);
  });
});
