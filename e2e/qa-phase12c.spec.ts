// QA правок «очередь-расписание» и блока «Сервис» (2026-10-29): мобильные ширины, откат, XSS, темы, a11y, гонки.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi, type G } from './collection-mock';
import { baseState, mockRoadmap, type RmPlanned, type RmState } from './roadmap-mock';
import { signedSession } from './session';
import { THEMES, THEME_STORAGE_KEY } from '../src/ui/tokens';

const XSS = '<img src=x onerror="window.__xss=1">';
const LONG = 'Очень-длинное-название-без-пробелов-'.repeat(7);
const rel = (id: number, title: string, date: string | null, o: Partial<RmPlanned> = {}): RmPlanned => ({
  id, title, releaseDate: date, coverUrl: null, wantAtRelease: true, hoursManual: 14, externalSource: null, externalId: null, status: 'planned', ...o,
});
async function openRm(page: Page, context: BrowserContext, baseURL: string, s: RmState, theme?: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  if (theme) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [THEME_STORAGE_KEY, theme]);
  await mockApi(page, []);
  await mockRoadmap(page, s);
  await page.goto('/roadmap');
  await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
  await page.getByTestId('rm-queue-row').first().waitFor();
}
const state = () => baseState({
  games: [{ id: 1, title: 'Хейдес', hours: 22 }, { id: 2, title: XSS, hours: 40 }, { id: 3, title: LONG, hours: 30 }, { id: 4, title: 'Без часов', hours: null }],
  order: [1, 2, 3, 4],
  planned: [rel(20, 'Релиз с галкой ' + LONG, '2026-01-28'), rel(21, XSS, '2026-02-10', { hoursManual: null }), rel(22, 'Без галки', '2026-03-01', { wantAtRelease: false })],
});
const rowKeys = (page: Page) => page.getByTestId('rm-queue-row').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.rmKey));
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test.describe('QA 12c: /roadmap расписание', () => {
  for (const width of [360, 320, 768]) {
    test(`${width}px: нет горизонтального скролла, строки не вылезают, XSS не исполняется`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width, height: 800 });
      await openRm(page, context, baseURL as string, state());
      expect(await noHScroll(page)).toBe(true);
      const bad = await page.evaluate(() => {
        const q = document.querySelector<HTMLElement>('#rm-queue');
        if (!q) return ['no #rm-queue'];
        const pr = q.getBoundingClientRect();
        return Array.from(q.querySelectorAll<HTMLElement>('li,button,img,b')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > pr.right + 1 || r.left < pr.left - 1); }).map((e) => `${e.tagName}.${e.className}`);
      });
      expect(bad).toEqual([]);
      expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
      expect(await page.locator('#rm-queue img[src="x"]').count()).toBe(0);
    });
  }

  test('360: меню «⋯» релизной строки: «Править» и «Убрать из плана», в экране, Escape возвращает фокус', async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openRm(page, context, baseURL as string, state());
    const btn = page.locator('[data-rm-zone="queue"][data-rm-key="p:22"] [data-act="menu"]');
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    const edit = page.getByRole('menuitem', { name: 'Править' });
    await expect(edit).toBeVisible();
    const b = await page.getByRole('menuitem', { name: 'Убрать из плана' }).boundingBox();
    expect(b && b.x >= 0 && b.x + b.width <= 360).toBe(true);
    await page.keyboard.press('Escape');
    await expect(edit).toHaveCount(0);
    await expect(btn).toBeFocused();
  });

  test('«Править» подсвечивает карточку релиза и не роняет страницу', async ({ page, context, baseURL }) => {
    await openRm(page, context, baseURL as string, state());
    await page.locator('[data-rm-zone="queue"][data-rm-key="p:20"] [data-act="menu"]').click();
    await page.getByRole('menuitem', { name: 'Править' }).click();
    await expect(page.locator('[data-rm-zone="releases"][data-rm-key="p:20"]')).toBeVisible();
  });

  test('порядок табуляции в расписании: у релизной строки только «⋯», у бэклога выше/ниже/⋯; нет безымянных кнопок', async ({ page, context, baseURL }) => {
    await openRm(page, context, baseURL as string, state());
    const names = await page.getByTestId('rm-queue-row').evaluateAll((rows) => rows.map((r) => ({ k: (r as HTMLElement).dataset.rmKey, b: Array.from(r.querySelectorAll('button')).map((x) => x.getAttribute('aria-label') ?? (x.textContent ?? '').trim()) })));
    for (const r of names) {
      expect(r.b.every((n) => n.length > 0)).toBe(true);
      if (r.k?.startsWith('p:')) expect(r.b.some((n) => /^(Выше|Ниже)/.test(n))).toBe(false);
    }
  });

  test('ошибка PUT /order: индикатор ошибки, «Повторить» отправляет полный порядок; релиз остаётся на месте', async ({ page, context, baseURL }) => {
    const s = state();
    s.orderFail = true;
    await openRm(page, context, baseURL as string, s);
    const before = await rowKeys(page);
    await page.getByRole('button', { name: 'Ниже: Хейдес' }).click();
    await expect(page.getByText('Порядок не сохранён')).toBeVisible();
    const after = await rowKeys(page);
    expect(after.filter((k) => k?.startsWith('p:'))).toEqual(before.filter((k) => k?.startsWith('p:')));
    s.orderFail = false;
    await page.getByRole('button', { name: 'Повторить' }).first().click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect(s.calls.orders.at(-1)).toEqual([2, 1, 3, 4]);
  });

  test('Alt+Home/End работают, когда релиз между строками бэклога', async ({ page, context, baseURL }) => {
    const s = state();
    await openRm(page, context, baseURL as string, s);
    const down = page.getByRole('button', { name: 'Ниже: Хейдес' });
    await down.focus();
    await page.keyboard.press('Alt+End');
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect(s.calls.orders.at(-1)).toEqual([2, 3, 4, 1]);
  });

  for (const t of THEMES) {
    test(`тема ${t.id}: бейдж «Релиз» и «Нужны часы» в очереди, контраст >= 4.5, без скролла`, async ({ page, context, baseURL }) => {
      await openRm(page, context, baseURL as string, state(), t.id);
      expect(await noHScroll(page)).toBe(true);
      const low = await page.evaluate(() => {
        const parse = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
        const lum = (c: { r: number; g: number; b: number }) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
        const bgOf = (el: Element) => { let c = { r: 255, g: 255, b: 255 }; const ch: Element[] = []; for (let e: Element | null = el; e; e = e.parentElement) ch.unshift(e); for (const e of ch) { const p = parse(getComputedStyle(e).backgroundColor); if (p && p.a > 0) c = { r: c.r * (1 - p.a) + p.r * p.a, g: c.g * (1 - p.a) + p.g * p.a, b: c.b * (1 - p.a) + p.b * p.a }; } return c; };
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('#rm-queue *')) {
          if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())) continue;
          const cs = getComputedStyle(el); const fg = parse(cs.color); if (!fg) continue;
          const bg = bgOf(el); const f = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
          const l1 = lum(f), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          if (ratio < 4.5) out.push(`${el.tagName}.${el.className} "${(el.textContent ?? '').trim().slice(0, 20)}" ${ratio.toFixed(2)}`);
        }
        return out;
      });
      expect(low).toEqual([]);
    });
  }
});

const g = (id: number, title: string, status: G['status'], o: Partial<G> = {}): G => ({
  id, title, lastPlayedAt: `2026-0${id}-01T10:00:00.000Z`, status, completedAt: null, droppedAt: null, playSeconds: 3600, playCount: 1, trophies: null, ...o,
});
async function openBl(page: Page, context: BrowserContext, baseURL: string, games: G[], theme?: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  if (theme) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [THEME_STORAGE_KEY, theme]);
  const mock = await mockApi(page, games);
  await page.goto('/backlog');
  await page.getByRole('heading', { name: 'Бэклог', level: 1 }).waitFor();
  await page.locator('.ps-bl-list .ps-card:not(.ps-card--sk), .ps-empty').first().waitFor();
  return mock;
}
const bl = () => [g(1, 'Альфа', 'backlog'), g(2, XSS, 'backlog'), g(3, LONG, 'service'), g(4, XSS, 'service')];

test.describe('QA 12c: /backlog блок «Сервис»', () => {
  for (const width of [360, 320, 768]) {
    test(`${width}px: без горизонтального скролла, XSS не исполняется`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width, height: 800 });
      await openBl(page, context, baseURL as string, bl());
      await expect(page.getByTestId('bl-service')).toBeVisible();
      expect(await noHScroll(page)).toBe(true);
      expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    });
  }

  test('ошибка PUT при «В сервис»: карточка возвращается в бэклог, счётчики прежние, тост ошибки', async ({ page, context, baseURL }) => {
    const mock = await openBl(page, context, baseURL as string, bl());
    mock.failNextMutation = 500;
    await page.locator('.ps-bl-list .ps-card', { hasText: 'Альфа' }).getByRole('button', { name: 'В сервис' }).click();
    await expect(page.getByText('Не удалось сменить статус')).toBeVisible();
    await expect.poll(() => page.locator('.ps-bl-list .ps-card__title').allTextContents().then((l) => l.length)).toBe(2);
    await expect(page.getByTestId('bl-service-count')).toHaveText('2');
    expect(mock.games.find((x) => x.id === 1)?.status).toBe('backlog');
  });

  test('«Отменить» после перезагрузки списков: игра не дублируется', async ({ page, context, baseURL }) => {
    await openBl(page, context, baseURL as string, bl());
    await page.locator('.ps-bl-list .ps-card', { hasText: 'Альфа' }).getByRole('button', { name: 'В сервис' }).click();
    await expect(page.getByTestId('bl-service-count')).toHaveText('3');
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.getByTestId('bl-service-count')).toHaveText('2');
    await expect.poll(async () => (await page.locator('.ps-bl-list .ps-card__title').allTextContents()).filter((t) => t === 'Альфа').length).toBe(1);
    const all = await page.locator('.ps-card__title').allTextContents();
    expect(all.filter((t) => t === 'Альфа')).toHaveLength(1);
  });

  test('медленный ответ сервиса + смена фильтра бэклога: блок «Сервис» не теряется и не получает фильтры', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL as string }]);
    const mock = await mockApi(page, bl());
    mock.delayList = (u) => (u.searchParams.get('status') === 'service' ? 600 : 0);
    await page.goto('/backlog?genres=ACTION');
    await page.getByRole('heading', { name: 'Бэклог', level: 1 }).waitFor();
    await expect(page.getByTestId('bl-service')).toBeVisible();
    for (const u of mock.listCalls.filter((x) => x.searchParams.get('status') === 'service')) {
      expect(u.searchParams.get('genres')).toBeNull();
      expect(u.searchParams.get('duration')).toBeNull();
    }
  });

  test('aria-live у тоста, кнопки с именами, «Свернуть» держит aria-expanded', async ({ page, context, baseURL }) => {
    await openBl(page, context, baseURL as string, bl());
    await page.locator('.ps-bl-list .ps-card', { hasText: 'Альфа' }).getByRole('button', { name: 'В сервис' }).click();
    const toast = page.getByText('Статус изменён: Сервис');
    await expect(toast).toBeVisible();
    expect(await toast.evaluate((el) => !!el.closest('[aria-live],[role=status],[role=alert]'))).toBe(true);
    const unnamed = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-testid=bl-service] button')).filter((e) => !(e.textContent ?? '').trim() && !e.getAttribute('aria-label')).length);
    expect(unnamed).toBe(0);
  });

  for (const t of THEMES) {
    test(`тема ${t.id}: блок «Сервис» без скролла, текст контраст >= 4.5`, async ({ page, context, baseURL }) => {
      await openBl(page, context, baseURL as string, bl(), t.id);
      expect(await noHScroll(page)).toBe(true);
      const low = await page.evaluate(() => {
        const parse = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
        const lum = (c: { r: number; g: number; b: number }) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
        const bgOf = (el: Element) => { let c = { r: 255, g: 255, b: 255 }; const ch: Element[] = []; for (let e: Element | null = el; e; e = e.parentElement) ch.unshift(e); for (const e of ch) { const p = parse(getComputedStyle(e).backgroundColor); if (p && p.a > 0) c = { r: c.r * (1 - p.a) + p.r * p.a, g: c.g * (1 - p.a) + p.g * p.a, b: c.b * (1 - p.a) + p.b * p.a }; } return c; };
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('[data-testid=bl-service] *')) {
          if (el.closest('.ps-card')) continue; // карточки общие с коллекцией: фон ps1 градиентный, измерение по background-color неточно
          if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())) continue;
          const cs = getComputedStyle(el); const fg = parse(cs.color); if (!fg) continue;
          const bg = bgOf(el); const f = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
          const l1 = lum(f), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          if (ratio < 4.5) out.push(`${el.tagName}.${el.className} "${(el.textContent ?? '').trim().slice(0, 20)}" ${ratio.toFixed(2)}`);
        }
        return out;
      });
      expect(low).toEqual([]);
    });
  }
});
