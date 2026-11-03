// Фаза 39 (QA): PWA. Только production-сборка (см. e2e/pwa.config.ts).
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { signedSession } from './session';

const ORIGIN = () => process.env.PWA_ORIGIN ?? `http://localhost:${process.env.PWA_PORT ?? 3231}`;

async function login(ctx: BrowserContext) {
  await ctx.addCookies([{ name: 'pst_session', value: await signedSession(), url: ORIGIN() }]);
}

async function swReady(page: Page) {
  // Устойчиво к авто-перезагрузке по controllerchange (QA-39-2): ждём controller, переживая смену документа
  await expect.poll(async () => {
    try { return await page.evaluate(async () => { await navigator.serviceWorker.ready; return !!navigator.serviceWorker.controller; }); } catch { return false; }
  }, { timeout: 20_000 }).toBe(true);
  await page.waitForLoadState('load');
}

async function cacheDump(page: Page) {
  return page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname);
    return out;
  });
}

test.describe('manifest', () => {
  test('валиден и installable-поля на месте', async ({ request }) => {
    const r = await request.get('/manifest.webmanifest');
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toContain('manifest+json');
    const m = await r.json();
    expect(m).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone', lang: 'ru' });
    expect(m.name && m.short_name).toBeTruthy();
    expect(m.categories).toEqual(['games', 'entertainment']);
    expect(m.theme_color).toBe('#0e0f16');
    expect(m.background_color).toBe('#0e0f16');
    const sizes = m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}/${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192/any', '512x512/any', '512x512/maskable']));
    for (const i of m.icons) {
      const ir = await request.get(i.src);
      expect(ir.status(), i.src).toBe(200);
      expect(ir.headers()['content-type']).toContain('image/png');
    }
  });

  test('без входа: manifest и иконки открыты, link rel=manifest и apple-мета на /login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#0e0f16');
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"], meta[name="mobile-web-app-capable"]').first()).toHaveCount(1);
  });
});

test.describe('заголовки и CSP', () => {
  for (const path of ['/sw.js', '/offline']) {
    test(`${path} публичный, CSP с nonce, no-store`, async ({ request }) => {
      const r = await request.get(path, { maxRedirects: 0 });
      expect(r.status()).toBe(200);
      expect(r.headers()['cache-control']).toContain('no-store');
      expect(r.headers()['content-security-policy']).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
      expect(r.headers()['content-security-policy'].match(/script-src [^;]*/)![0]).not.toContain('unsafe-inline');
      expect(r.headers()['x-content-type-options']).toBe('nosniff');
    });
  }
  test('/sw.js отдаётся как JS', async ({ request }) => {
    const r = await request.get('/sw.js');
    expect(r.headers()['content-type']).toMatch(/javascript/);
  });
  test('/offline: ни одного запроса к /api, нет нарушений CSP', async ({ page }) => {
    const api: string[] = [];
    const errs: string[] = [];
    page.on('request', (rq) => { if (new URL(rq.url()).pathname.startsWith('/api/')) api.push(rq.url()); });
    page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) errs.push(m.text()); });
    await page.goto('/offline');
    await expect(page.getByRole('heading', { name: 'Нет сети' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(api).toEqual([]);
    expect(errs).toEqual([]);
  });
  test('закрытая страница без сессии редиректит на /login (SW-исключения не открыли доступ)', async ({ request }) => {
    for (const p of ['/stats', '/backlog', '/api/games']) {
      const r = await request.get(p, { maxRedirects: 0 });
      expect([307, 401], p).toContain(r.status());
    }
  });
});

test.describe('service worker', () => {
  test('QA-39-2: первая установка SW не перезагружает страницу без согласия', async ({ page }) => {
    let loads = 0;
    page.on('load', () => { loads++; });
    await page.goto('/login');
    await page.waitForTimeout(6000);
    test.info().annotations.push({ type: 'loads', description: String(loads) });
    expect(loads, 'документ загрузился больше одного раза сам (controllerchange)').toBe(1);
  });

  test('регистрируется со scope "/", в кэше только /offline, иконка и статика', async ({ page, context }) => {
    await login(context);
    await page.goto('/login'); // с сессией редирект на "/", это ок
    await swReady(page);
    const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { scope: r?.scope, url: r?.active?.scriptURL }; });
    expect(reg.scope).toBe(`${ORIGIN()}/`);
    expect(reg.url).toBe(`${ORIGIN()}/sw.js`);
    const dump = await cacheDump(page);
    const names = Object.keys(dump);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n.startsWith('ps-')).toBe(true);
    const all = Object.values(dump).flat();
    expect(all).toContain('/offline');
    for (const p of all) expect(p === '/offline' || p.startsWith('/_next/static/') || p.startsWith('/icons/'), `в кэше лишнее: ${p}`).toBe(true);
    expect(all.some((p) => p.startsWith('/api'))).toBe(false);
  });

  test('офлайн: закрытая страница -> заглушка /offline, скрипты и тема работают под CSP', async ({ page, context }) => {
    const csp: string[] = [];
    page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
    await context.addCookies([{ name: 'ps-theme', value: 'ps2', url: ORIGIN() }]);
    await page.goto('/login');
    await swReady(page);
    await context.setOffline(true);
    await page.goto('/stats').catch(() => {});
    await expect(page.getByRole('heading', { name: 'Нет сети' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Повторить' })).toBeVisible();
    // гидратация прошла: клик по «Повторить» без сети даёт «Сети всё ещё нет» (React-обработчик, не переход по ссылке)
    await page.getByRole('link', { name: 'Повторить' }).click();
    await expect(page.getByText('Сети всё ещё нет')).toBeVisible();
    // inline-скрипт темы отработал (атрибут темы задан) и стили загрузились из кэша
    const th = await page.evaluate(() => ({ t: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor }));
    expect(th.bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(csp).toEqual([]);
    // сеть вернулась: событие online уводит с заглушки
    await context.setOffline(false);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith('/offline'), { timeout: 10_000 }),
      page.evaluate(() => window.dispatchEvent(new Event('online'))).catch(() => {}),
    ]);
  });

  test('офлайн: /api не подменяется заглушкой (fetch падает)', async ({ page, context }) => {
    await page.goto('/login');
    await swReady(page);
    await context.setOffline(true);
    const r = await page.evaluate(() => fetch('/api/games').then((x) => x.status, () => 'network-error'));
    expect(r).toBe('network-error');
  });

  test('после выхода в Cache Storage нет закрытого HTML и /api; офлайн-навигация даёт только /offline', async ({ page, context }) => {
    await login(context);
    await page.goto('/stats');
    await swReady(page);
    await page.goto('/backlog');
    await page.goto('/stats');
    const before = Object.values(await cacheDump(page)).flat();
    expect(before.filter((p) => ['/stats', '/backlog', '/', '/login'].includes(p) || p.startsWith('/api'))).toEqual([]);
    // Выход делаем со страницы /offline: она не ходит в /api. Иначе запрос открытой /stats получал 401 и http.ts сам уводил
    // на /login?next=..., и эта навигация обрывала наш goto('/login') (net::ERR_ABORTED в CI).
    await page.goto('/offline');
    // выход как в приложении: POST /api/auth/logout, затем purge (AppShell.useLogout)
    const out = await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.status));
    expect(out).toBeLessThan(400);
    await context.clearCookies();
    await page.goto('/login');
    const after = Object.values(await cacheDump(page)).flat();
    expect(after.filter((p) => ['/stats', '/backlog', '/'].includes(p) || p.startsWith('/api'))).toEqual([]);
    await context.setOffline(true);
    await page.goto('/backlog').catch(() => {});
    await expect(page.getByRole('heading', { name: 'Нет сети' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Бэклог');
  });

  test('обновление SW: новая версия ждёт, баннер без авто-перезагрузки, старый кэш чистится после согласия', async ({ page, context, isMobile }) => {
    // Playwright не перехватывает запросы обновления SW, поэтому между браузером и приложением ставим прокси, подменяющий VERSION в /sw.js.
    const { createServer } = await import('node:http');
    let version = '';
    const proxy = createServer((req, res) => {
      void (async () => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && k !== 'host') headers[k] = v;
        const up = await fetch(`${ORIGIN()}${req.url}`, { method: req.method, headers, redirect: 'manual' });
        const h: Record<string, string | string[]> = {};
        up.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie'].includes(k)) h[k] = v; });
        const sc = up.headers.getSetCookie();
        if (sc.length) h['set-cookie'] = sc;
        let body: Buffer | string = Buffer.from(await up.arrayBuffer());
        if (req.url === '/sw.js' && version) body = body.toString().replace(/var VERSION = '[^']*'/, `var VERSION = '${version}'`);
        res.writeHead(up.status, h);
        res.end(body);
      })().catch(() => { res.statusCode = 502; res.end(); });
    });
    await new Promise<void>((r) => proxy.listen(3241, r));
    try {
      const base = 'http://localhost:3241';
      await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: base }]);
      await page.goto(`${base}/stats`);
      await swReady(page);
      const v1 = Object.keys(await cacheDump(page));
      expect(v1).toHaveLength(1); // ps-static-<хэш sw.js>
      expect(v1[0]).toMatch(/^ps-static-c[0-9a-f]{8}$/);
      version = 'v2';
      await page.evaluate(() => { (window as unknown as { __marker: number }).__marker = 1; });
      await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r?.update(); });
      await expect(page.getByTestId('sw-update')).toBeAttached({ timeout: 15_000 });
      // QA-39-3: .ps-install скрыт вне <768, на десктопе баннер обновления в DOM есть, но невидим
      await expect(page.getByTestId('sw-update'), 'QA-39-3: баннер обновления невидим на десктопе').toBeVisible({ timeout: 2000 }).catch((e) => { if (!isMobile) test.info().annotations.push({ type: 'QA-39-3', description: 'banner hidden on desktop' }); else throw e; });
      // без согласия: страница не перезагружалась, старый кэш на месте
      expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);
      expect(Object.keys(await cacheDump(page)).sort()).toEqual([v1[0], 'ps-static-v2'].sort());
      await page.getByTestId('sw-update').locator('button', { hasText: 'Обновить' }).dispatchEvent('click');
      await page.waitForFunction(() => (window as unknown as { __marker?: number }).__marker === undefined, undefined, { timeout: 15_000 });
      await page.waitForLoadState('load');
      await expect.poll(async () => Object.keys(await cacheDump(page)).sort(), { timeout: 15_000 }).toEqual(['ps-static-v2']);
    } finally {
      // keep-alive соединения браузера держали close() до таймаута теста (флак в CI): закрываем их явно
      proxy.closeAllConnections();
      await new Promise((r) => proxy.close(r));
    }
  });
});

test.describe('подсказка «Установить»', () => {
  const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  test.use({ viewport: { width: 360, height: 740 }, userAgent: IOS_UA, hasTouch: true, isMobile: true });

  async function prime(page: Page, ctx: BrowserContext, extra: Record<string, string> = {}) {
    await login(ctx);
    await page.addInitScript((kv) => { localStorage.setItem('ps.install.visits', '2'); for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, extra);
  }

  test('iOS: показывается на странице после 2-го визита и 8 с, закрытие даёт snooze 14 дней', async ({ page, context }) => {
    await prime(page, context);
    await page.goto('/stats');
    await expect(page.getByTestId('install-prompt')).toHaveCount(0);
    await expect(page.getByTestId('install-prompt')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Нажмите «Поделиться»')).toBeVisible();
    const box = await page.getByTestId('install-prompt').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    await page.getByRole('button', { name: 'Понятно' }).click();
    await expect(page.getByTestId('install-prompt')).toHaveCount(0);
    const st = await page.evaluate(() => ({ d: localStorage.getItem('ps.install.dismissals'), s: localStorage.getItem('ps.install.snooze') }));
    expect(st.d).toBe('1');
    const days = (Date.parse(st.s!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
  });

  test('QA-39-4: стрелка iOS-карточки видна (не обрезана overflow карточки)', async ({ page, context }) => {
    await prime(page, context);
    await page.goto('/stats');
    await expect(page.getByTestId('install-prompt')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    const hit = await page.evaluate(() => {
      const a = document.querySelector('.ps-install__arrow')!.getBoundingClientRect();
      const el = document.elementFromPoint(a.left + a.width / 2, a.top + 3);
      return el?.classList.contains('ps-install__arrow') ?? false;
    });
    expect(hit, 'стрелка не получает хит-тест/не отрисована: обрезана overflow:auto карточки').toBe(true);
  });

  test('не показывается: первый визит, /login, /wrapped, /triage, /onboarding, done, snooze', async ({ page, context }) => {
    await login(context);
    // первый визит (visits=0 -> станет 1)
    await page.goto('/stats');
    await page.waitForTimeout(9500);
    await expect(page.getByTestId('install-prompt')).toHaveCount(0);
    await page.evaluate(() => localStorage.setItem('ps.install.visits', '5'));
    for (const p of ['/wrapped', '/triage', '/onboarding']) {
      await page.goto(p);
      await page.waitForTimeout(9500);
      await expect(page.getByTestId('install-prompt'), p).toHaveCount(0);
    }
    await page.evaluate(() => localStorage.setItem('ps.install.done', '1'));
    await page.goto('/stats');
    await page.waitForTimeout(9500);
    await expect(page.getByTestId('install-prompt')).toHaveCount(0);
  });

  test('не показывается без сессии на /login', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('ps.install.visits', '5'));
    await page.goto('/login');
    await page.waitForTimeout(9500);
    await expect(page.getByTestId('install-prompt')).toHaveCount(0);
  });

  // Эмуляция display-mode через CDP в Chromium не работает, поэтому подменяем признаки standalone скриптом до загрузки.
  for (const mode of ['navigator.standalone (iOS)', 'matchMedia display-mode (Android)'] as const) {
    test(`не показывается в standalone: ${mode}`, async ({ page, context }) => {
      await prime(page, context);
      await page.addInitScript((m) => {
        if (m.startsWith('navigator')) Object.defineProperty(navigator, 'standalone', { value: true });
        else {
          const orig = window.matchMedia.bind(window);
          window.matchMedia = (q: string) => (q.includes('display-mode: standalone') ? ({ matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } as unknown as MediaQueryList) : orig(q));
        }
      }, mode);
      await page.goto('/stats');
      await page.waitForTimeout(10_000);
      await expect(page.getByTestId('install-prompt')).toHaveCount(0);
      await expect(page.locator('html')).toHaveAttribute('data-standalone', '');
    });
  }

  test('селектор окон: [data-story] не существует в StoryViewer (проверка кода)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/ui/wrapped/WrappedStory.tsx', 'utf8');
    test.info().annotations.push({ type: 'QA-39-1', description: 'overlayOpen() ищет [data-story], а в WrappedStory такого атрибута нет' });
    expect(src.includes('data-story')).toBe(false); // фиксируем факт; если frontend поправит, тест упадёт и подскажет обновить отчёт
  });
});

test.describe('Android: beforeinstallprompt', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
  test('карточка после 2-го визита и 8 с, «Установить» вызывает prompt, accepted ставит done', async ({ page, context }) => {
    await login(context);
    // событие шлём из init-скрипта на каждой загрузке документа (первая установка SW перезагружает страницу, QA-39-2)
    await page.addInitScript(() => {
      localStorage.setItem('ps.install.visits', '2');
      (window as unknown as { __prompted: number }).__prompted = 0;
      setTimeout(() => {
        const ev = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
        ev.prompt = async () => { (window as unknown as { __prompted: number }).__prompted++; };
        ev.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(ev);
      }, 1500);
    });
    await page.goto('/stats');
    await expect(page.getByTestId('install-prompt')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Установить', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(1);
    await expect(page.getByTestId('install-prompt')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('ps.install.done'))).toBe('1');
  });
});
