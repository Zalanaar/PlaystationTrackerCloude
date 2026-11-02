// Регресс: открыть и закрыть окно игры не должно менять прокрутку (Коллекция: правая колонка уезжала наверх, Бэклог: вниз).
import { test, expect, type Page } from '@playwright/test';
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

/** Ряд карточек ближе к концу списка в центре экрана; помечает крайнюю левую или правую карточку ряда. */
async function pick(page: Page, side: 'left' | 'right'): Promise<number> {
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('article.ps-card')];
    cards[Math.floor(cards.length * 0.6)].scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(1200); // scroll-spy и ленивые блоки успокаиваются
  return page.evaluate((s) => {
    const cards = [...document.querySelectorAll<HTMLElement>('article.ps-card')];
    const top = Math.round(cards[Math.floor(cards.length * 0.6)].getBoundingClientRect().top);
    const row = cards.filter((c) => Math.abs(Math.round(c.getBoundingClientRect().top) - top) < 4);
    const xs = row.map((c) => c.getBoundingClientRect().left);
    row[xs.indexOf(s === 'left' ? Math.min(...xs) : Math.max(...xs))].setAttribute('data-pick', '1');
    return row.length;
  }, side);
}

for (const [name, url] of [['Коллекция', '/?sort=last_played'], ['Бэклог', '/backlog']] as const) {
  for (const side of ['left', 'right'] as const) {
    for (const how of ['Escape', 'close'] as const) {
      test(`${name}: окно игры из ${side === 'left' ? 'левой' : 'правой'} колонки, закрытие ${how}: прокрутка на месте`, async ({ page, context, baseURL }) => {
        await context.addCookies([{ name: 'pst_session', value: await signedSession(), url: baseURL! }]);
        await mockApi(page, many());
        await page.goto(url);
        await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
        await expect(page.locator('article.ps-card').nth(20)).toBeAttached();
        expect(await pick(page, side)).toBeGreaterThan(side === 'right' ? 1 : 0);
        const before = await page.evaluate(() => window.scrollY);
        expect(before).toBeGreaterThan(300);
        await page.locator('article.ps-card[data-pick="1"]').getByRole('button', { name: /^Открыть:/ }).first().click();
        const dlg = page.getByRole('dialog');
        await expect(dlg).toBeVisible();
        if (how === 'Escape') await page.keyboard.press('Escape');
        else await dlg.getByRole('button', { name: 'Закрыть' }).first().click();
        await expect(dlg).toHaveCount(0);
        await page.waitForTimeout(800);
        expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(4);
      });
    }
  }
}
