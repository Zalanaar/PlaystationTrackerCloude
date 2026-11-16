// П8.1: на iPhone (390 px, и 360 — узкие Android/mini) название раздела в шапке не обрезается («Коллекц…»): сжимается статус синка, а не заголовок.
// Худший случай: два профиля PSN (чип профиля в шапке) и статус синка с текстом.
import { test, expect, type Page } from '@playwright/test';
import { setup, TWO, ONE } from './profiles-mock';

const PAGES = [['/', 'Коллекция'], ['/backlog', 'Бэклог'], ['/stats', 'Статистика'], ['/triage', 'Разбор']] as const;

async function titleFits(page: Page, label: string) {
  const t = page.locator('.ps-header__title');
  await expect(t).toHaveText(label);
  const m = await t.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, right: el.getBoundingClientRect().right }));
  expect(m.sw, `${label}: текст шире блока (обрезан)`).toBeLessThanOrEqual(m.cw + 1);
  // шапка не вылезает за экран
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const right = await page.locator('.ps-header__right').boundingBox();
  expect(right!.x + right!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 0.5);
}

for (const w of [390, 360]) for (const [name, profiles] of [['один профиль', ONE], ['два профиля', TWO]] as const) {
  test(`шапка ${w} px, ${name}: заголовок раздела целиком на всех вкладках`, async ({ page, baseURL }, info) => {
    test.skip(info.project.name === 'desktop', 'только мобильная шапка');
    await page.setViewportSize({ width: w, height: 844 });
    await setup(page, baseURL!, profiles());
    for (const [path, label] of PAGES) {
      await page.goto(path);
      await expect(page.locator('.ps-btn--sync')).toBeVisible();
      await titleFits(page, label);
    }
  });
}
