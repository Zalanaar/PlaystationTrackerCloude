// Общие помощники e2e для страницы «Бэклог» (Фаза 33): на мобильном фильтры в sheet, действия HLTB в меню страницы, вид по умолчанию «Список».
import { expect, type Page } from '@playwright/test';

export const isMobile = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 768;


/** Мобильный: открыть sheet «Фильтры и сортировка» (если закрыт). Десктоп: ничего, фильтры на странице. */
export async function openFilters(page: Page): Promise<void> {
  if (!isMobile(page)) return;
  const dlg = page.getByRole('dialog', { name: 'Фильтры и сортировка' });
  if (await dlg.count()) return;
  await page.getByRole('button', { name: /^Фильтры и сортировка/ }).click();
  await expect(dlg).toBeVisible();
}

/** Раскрыть жанры: десктоп жмёт «Жанр», мобильный показывает их в sheet сразу. */
export async function openGenres(page: Page): Promise<void> {
  if (isMobile(page)) { await openFilters(page); return; }
  const btn = page.getByRole('button', { name: /^Жанр/ });
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
}

/** Закрыть sheet фильтров на мобильном (Esc), на десктопе ничего. */
export async function closeFilters(page: Page): Promise<void> {
  if (isMobile(page) && (await page.getByRole('dialog', { name: 'Фильтры и сортировка' }).count())) {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Фильтры и сортировка' })).toHaveCount(0);
  }
}

/** Сортировка: десктоп селектом, мобильный радиокнопкой в sheet. */
export async function chooseSort(page: Page, id: 'last_played' | 'title' | 'duration' | 'duration_desc', label: string): Promise<void> {
  if (isMobile(page)) {
    await openFilters(page);
    await page.getByRole('radio', { name: label }).click();
  } else {
    await page.getByLabel('Сортировка').selectOption(id);
  }
}

/** Проверить доступность пунктов HLTB в меню страницы (меню открывается и закрывается). */
export async function expectHltbEnabled(page: Page, enabled: boolean): Promise<void> {
  await page.getByRole('button', { name: 'Ещё: действия со страницей' }).click();
  const item = page.getByRole('menuitem', { name: /^Подтянуть длительность с HLTB/ });
  if (enabled) await expect(item).toBeEnabled(); else await expect(item).toBeDisabled();
  await page.keyboard.press('Escape');
}

/** Запустить подгрузку HLTB через меню страницы. */
export async function startHltb(page: Page, recheck = false): Promise<void> {
  await page.getByRole('button', { name: 'Ещё: действия со страницей' }).click();
  await page.getByRole('menuitem', { name: recheck ? /^Перепроверить не найденные/ : /^Подтянуть длительность с HLTB/ }).click();
}
