// Регресс: открыть и закрыть окно игры не должно менять прокрутку (Коллекция: правая колонка уезжала наверх, Бэклог: вниз).
// Режим «как Safari на iPhone»: нажатая кнопка не получает фокус (activeElement остаётся body). Именно так ошибка воспроизводилась:
// спасение фокуса ставило фокус на заголовок Коллекции с прокруткой, а Бэклог без источника фокуса не возвращал прокрутку.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { mockApi, seed, type G } from './collection-mock';
import { signedSession } from './session';

function many(): G[] {
  const base = seed();
  const extra: G[] = Array.from({ length: 60 }, (_, i) => ({
    id: 200 + i, title: `Игра ${i + 1}`, lastPlayedAt: new Date(Date.UTC(2026, 9 - Math.floor(i / 6), 20 - (i % 6), 10)).toISOString(),
    status: i % 2 ? 'backlog' as const : 'completed' as const, completedAt: i % 2 ? null : new Date(Date.UTC(2026, 9 - Math.floor(i / 6), 20 - (i % 6), 10)).toISOString(),
    droppedAt: null, playSeconds: 3600 * (i + 1), playCount: 2, trophies: null,
  }));
  return [...base, ...extra];
}

/** Ряд элементов ближе к концу списка в центре экрана; помечает крайний левый или правый элемент ряда. */
async function pick(page: Page, sel: string, side: 'left' | 'right'): Promise<number> {
  await page.evaluate((q) => {
    const items = [...document.querySelectorAll<HTMLElement>(q)];
    items[Math.floor(items.length * 0.6)].scrollIntoView({ block: 'center' });
  }, sel);
  await page.waitForTimeout(1200); // scroll-spy и ленивые блоки успокаиваются
  return page.evaluate(([q, s]) => {
    const items = [...document.querySelectorAll<HTMLElement>(q)];
    const top = Math.round(items[Math.floor(items.length * 0.6)].getBoundingClientRect().top);
    const row = items.filter((c) => Math.abs(Math.round(c.getBoundingClientRect().top) - top) < 4);
    const xs = row.map((c) => c.getBoundingClientRect().left);
    row[xs.indexOf(s === 'left' ? Math.min(...xs) : Math.max(...xs))].setAttribute('data-pick', '1');
    return row.length;
  }, [sel, side] as const);
}

/** Safari на iPhone и macOS не фокусирует кнопку по нажатию: отменяем фокус по mousedown. */
async function iosFocus(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener('mousedown', (e) => { if (e.target instanceof Element && e.target.closest('button, a')) e.preventDefault(); }, true);
  });
}

/** Нажатие по центру элемента: в WebKit (WPE) проверка «элемент неподвижен» у click() не дожидается конца анимаций. */
async function press(page: Page, loc: Locator) {
  await expect(loc).toBeVisible();
  const b = (await loc.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

type Case = { name: string; url: string; view?: 'cards' | 'list'; sel: string };
const CASES: Case[] = [
  { name: 'Коллекция', url: '/?sort=last_played', sel: 'article.ps-card' },
  { name: 'Бэклог', url: '/backlog', view: 'cards', sel: 'article.ps-card' },
  { name: 'Бэклог', url: '/backlog', view: 'list', sel: '[data-testid="bl-row"]' },
];

for (const ios of [false, true]) {
  for (const c of CASES) {
    for (const side of (c.view === 'list' ? ['left'] : ['left', 'right']) as ('left' | 'right')[]) {
      for (const how of (ios ? ['close'] : ['Escape', 'close']) as ('Escape' | 'close')[]) {
        const title = `${ios ? '[фокус как в Safari] ' : ''}${c.name}${c.view ? ` (${c.view === 'list' ? 'список' : 'карточки'})` : ''}: окно игры из ${side === 'left' ? 'левой' : 'правой'} колонки, закрытие ${how}: прокрутка на месте`;
        test(title, async ({ page, context, baseURL }, info) => {
          test.skip(c.view === 'list' && info.project.name === 'desktop', 'вид «Список» проверяем на мобильных');
          if (info.project.name.startsWith('webkit')) test.setTimeout(90_000);
          await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
          if (c.view) await page.addInitScript((v) => localStorage.setItem('ps-bl-view', v), c.view);
          if (ios) await iosFocus(page);
          await mockApi(page, many());
          await page.goto(c.url);
          await expect(page.getByRole('heading', { level: 1, name: c.name })).toBeVisible();
          await expect(page.locator(c.sel).nth(20)).toBeAttached();
          expect(await pick(page, c.sel, side)).toBeGreaterThan(side === 'right' ? 1 : 0);
          const before = await page.evaluate(() => window.scrollY);
          expect(before).toBeGreaterThan(300);
          await press(page, page.locator(`${c.sel}[data-pick="1"]`).getByRole('button', { name: /^Открыть:/ }).first());
          const dlg = page.getByRole('dialog');
          await expect(dlg).toBeVisible();
          if (how === 'Escape') await page.keyboard.press('Escape');
          // крестик: событие click напрямую, в WPE анимация появления окна может стоять и координаты кнопки неточны
          else await dlg.getByRole('button', { name: 'Закрыть' }).first().dispatchEvent('click');
          await expect(dlg).toHaveCount(0);
          await expect(page.getByRole('heading', { level: 1, name: c.name })).toBeVisible();
          await page.waitForTimeout(1500);
          expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(4);
        });
      }
    }
  }
}
