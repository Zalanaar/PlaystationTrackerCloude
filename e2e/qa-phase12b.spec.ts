// QA правок после выкатки Фазы 12: новые блоки (релизы, «Не распределено», сервисы) на мобильных ширинах и в 7 темах, XSS, a11y.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mockApi } from './collection-mock';
import { baseState, mockRoadmap, upc, type RmPlanned } from './roadmap-mock';
import { signedSession } from './session';
import { THEMES, THEME_STORAGE_KEY } from '../src/ui/tokens';

const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';
const LONG = 'Очень-длинное-название-игры-без-пробелов-'.repeat(6);
const rel = (id: number, title: string, o: Partial<RmPlanned> = {}): RmPlanned => ({
  id, title, releaseDate: '2026-12-10', coverUrl: null, wantAtRelease: true, hoursManual: 20, externalSource: null, externalId: null, status: 'planned', ...o,
});

async function open(page: Page, context: BrowserContext, baseURL: string, theme?: string) {
  await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL }]);
  if (theme) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [THEME_STORAGE_KEY, theme]);
  await mockApi(page, []);
  const s = baseState({
    games: [{ id: 1, title: XSS, hours: 22 }, { id: 2, title: LONG, hours: 600 }, { id: 3, title: 'Год оф Вар', hours: 30 }, { id: 4, title: 'Без часов', hours: null }, { id: 5, title: 'Убранная ' + LONG, hours: 12 }],
    order: [1, 2, 3, 4, 5], excluded: [5],
    planned: [rel(7, XSS), { ...rel(8, LONG, { externalSource: 'rawg', externalId: '3' }), status: 'cancelled' }],
    serviceGames: [{ gameId: 9, title: XSS, coverUrl: null, playedHours: 312.4 }, { gameId: 10, title: LONG, coverUrl: null, playedHours: 80 }],
    upcoming: { pages: [[{ ...upc(1), title: XSS }, { ...upc(2), title: LONG }, upc(3)], [upc(4)]], fail: null },
  });
  await mockRoadmap(page, s);
  await page.goto('/roadmap');
  await page.getByRole('heading', { name: 'План', level: 1 }).waitFor();
  await expect(page.getByTestId('rm-upcoming-row').first()).toBeVisible();
  return s;
}

test.describe('QA 12b: новые блоки', () => {
  for (const width of [360, 320]) {
    test(`${width}px: нет горизонтального скролла, элементы блоков не вылезают за панель`, async ({ page, context, baseURL }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page, context, baseURL as string);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const bad = await page.evaluate(() => {
        const out: string[] = [];
        for (const sel of ['#rm-upcoming', '#rm-unallocated', '#rm-services', '#rm-over', '#rm-queue']) {
          const p = document.querySelector<HTMLElement>(sel);
          if (!p) { out.push(`${sel} missing`); continue; }
          const pr = p.getBoundingClientRect();
          for (const e of p.querySelectorAll<HTMLElement>('button,a,li,table,img')) {
            const r = e.getBoundingClientRect();
            if (r.width > 0 && (r.right > pr.right + 1 || r.left < pr.left - 1)) out.push(`${sel} ${e.tagName}.${e.className} ${Math.round(r.left)}-${Math.round(r.right)} vs ${Math.round(pr.left)}-${Math.round(pr.right)}`);
          }
        }
        return out;
      });
      expect(bad).toEqual([]);
    });
  }

  test('XSS в названиях (каталог, релиз, игра, сервис): ничего не исполняется, текст виден как текст', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    expect(await page.locator('#rm-upcoming img[src="x"], #rm-services img[src="x"], #rm-queue img[src="x"]').count()).toBe(0);
    await expect(page.getByTestId('rm-upcoming-row').first()).toContainText('<img src=x');
  });

  test('a11y: aria-live у списка релизов и у тоста, кнопки с именем, фокус виден', async ({ page, context, baseURL }) => {
    await open(page, context, baseURL as string);
    await expect(page.locator('#rm-upcoming [aria-live]')).toHaveCount(1);
    const first = page.getByTestId('rm-upcoming-row').nth(1);
    await first.getByRole('button', { name: /^В план:/ }).focus();
    const outline = await page.evaluate(() => { const s = getComputedStyle(document.activeElement as Element); return `${s.outlineStyle}|${s.outlineWidth}|${s.boxShadow}`; });
    expect(outline).not.toMatch(/^none\|0px\|none$/);
    await first.getByRole('button', { name: /^В план:/ }).click();
    await expect(page.locator('#rm-upcoming [aria-live]')).toContainText('В плане');
    await page.getByRole('button', { name: 'Убрать из плана: Без часов' }).click();
    const toast = page.getByText('Убрано из плана');
    await expect(toast).toBeVisible();
    expect(await toast.evaluate((el) => !!el.closest('[aria-live],[role=status],[role=alert]'))).toBe(true);
    // кнопки без имени
    const unnamed = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('main button, main a')).filter((e) => !(e.textContent ?? '').trim() && !e.getAttribute('aria-label') && !e.getAttribute('title')).length);
    expect(unnamed).toBe(0);
  });

  test('мобильное меню «⋯» очереди: открывается, пункт «Убрать из плана» доступен, меню в экране', async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await open(page, context, baseURL as string);
    const more = page.getByRole('button', { name: /^Ещё: / }).first();
    await more.scrollIntoViewIfNeeded();
    await more.click();
    const item = page.getByRole('menuitem', { name: 'Убрать из плана' });
    await expect(item).toBeVisible();
    const box = await item.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 360).toBe(true);
    await page.keyboard.press('Escape');
    await expect(item).toHaveCount(0);
  });

  for (const t of THEMES) {
    test(`тема ${t.id}: новые блоки без скролла и с контрастом текста >= 4.5 (3 для крупного)`, async ({ page, context, baseURL }) => {
      await open(page, context, baseURL as string, t.id);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const low = await page.evaluate(() => {
        const parse = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
        const lum = (c: { r: number; g: number; b: number }) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
        const bgOf = (el: Element) => { let c = { r: 255, g: 255, b: 255 }; const chain: Element[] = []; for (let e: Element | null = el; e; e = e.parentElement) chain.unshift(e); for (const e of chain) { const p = parse(getComputedStyle(e).backgroundColor); if (p && p.a > 0) c = { r: c.r * (1 - p.a) + p.r * p.a, g: c.g * (1 - p.a) + p.g * p.a, b: c.b * (1 - p.a) + p.b * p.a }; } return c; };
        const out: string[] = [];
        for (const sel of ['#rm-upcoming', '#rm-unallocated', '#rm-services']) {
          for (const el of document.querySelectorAll<HTMLElement>(`${sel} *`)) {
            const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
            if (!own || el.closest('[aria-hidden=true]')) continue;
            const cs = getComputedStyle(el);
            if ((el as HTMLButtonElement).disabled) continue;
            const fg = parse(cs.color); if (!fg) continue;
            const bg = bgOf(el);
            const a = fg.a; const f = { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
            const l1 = lum(f), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
            if (ratio < (large ? 3 : 4.5)) out.push(`${sel} ${el.tagName}.${el.className} "${(el.textContent ?? '').trim().slice(0, 20)}" ${ratio.toFixed(2)}`);
          }
        }
        return out;
      });
      expect(low).toEqual([]);
    });
  }
});
