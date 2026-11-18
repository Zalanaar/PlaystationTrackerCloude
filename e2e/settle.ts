// Ждём, пока закончатся конечные CSS-переходы и анимации (смена темы, появление sheet). В WebKit на CI фиксированной паузы
// бывает мало: axe меряет контраст кнопки посреди перехода фона. Бесконечные (скелетоны, спиннеры) не ждём.
import type { Page } from '@playwright/test';

export async function settle(page: Page, timeout = 5000): Promise<void> {
  await page.waitForTimeout(100);
  await page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
    null, { timeout },
  ).catch(() => undefined);
}
