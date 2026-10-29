// Общие помощники e2e Фазы 18: на мобильном (<768) сегмент вида и «Выбрать игры» живут в sheet «Фильтры».
import type { Page } from '@playwright/test';

const isNarrow = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

/** Переключает вид: «Крупно» | «Плотно» | «Список». */
export async function setView(page: Page, label: 'Крупно' | 'Плотно' | 'Список'): Promise<void> {
  if (isNarrow(page)) {
    await page.getByRole('button', { name: /Фильтры и сортировка/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Фильтры' });
    await dlg.getByRole('button', { name: label, exact: true }).click();
    await dlg.getByRole('button', { name: 'Готово' }).click();
  } else {
    await page.getByRole('button', { name: label, exact: true }).click();
  }
}

/** Включает режим «Выбрать». */
export async function enterSelect(page: Page): Promise<void> {
  if (isNarrow(page)) {
    await page.getByRole('button', { name: /Фильтры и сортировка/ }).click();
    await page.getByRole('menuitem', { name: 'Выбрать игры' }).click();
  } else {
    await page.getByRole('button', { name: 'Выбрать' }).click();
  }
}
