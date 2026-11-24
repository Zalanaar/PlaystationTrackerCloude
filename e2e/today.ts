import { expect, type Page } from '@playwright/test';

/** Раскрыть блок «Сегодня», если он есть и свёрнут. Карточки внутри иначе скрыты (`hidden`). */
export async function expandToday(page: Page): Promise<void> {
  const btn = page.getByTestId('today-toggle');
  if (await btn.count() === 0) return;
  if (await btn.getAttribute('aria-expanded') === 'true') return;
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
}
