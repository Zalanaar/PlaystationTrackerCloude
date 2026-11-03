// D-P2 (пакет 2): на мобильном «Поиск» и «+» живут в шапке, кнопки страницы скрыты. Хелперы берут видимую.
import { expect, type Locator, type Page } from '@playwright/test';

/** «Добавить из магазина PS»: кнопка страницы (десктоп) или «+» шапки (мобильный). */
export function addBtn(page: Page): Locator {
  return page.locator('[data-testid="bl-add"]:visible, [data-testid="hdr-add"]:visible').first();
}

/** Поле поиска игры; на мобильном сначала открывает его кнопкой шапки. */
export async function searchBox(page: Page): Promise<Locator> {
  const box = page.getByRole('searchbox', { name: 'Поиск игры' }).filter({ visible: true }).first();
  const hdr = page.getByTestId('hdr-search').filter({ visible: true }).first();
  await expect(box.or(hdr).first()).toBeVisible();
  if (!(await box.isVisible())) await hdr.click();
  await expect(box).toBeVisible();
  return box;
}
