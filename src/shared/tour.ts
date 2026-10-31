// Версия интерактивного тура (контракт 23.1). Менять вручную, когда тур нужно показать всем ещё раз.
export const TOUR_VERSION = 1;

/**
 * Автозапуск тура (контракт 23.3): онбординг пройден и пройденная версия ниже текущей.
 * Существующим пользователям (в т.ч. owner) тур не навязывается: миграция 0016 ставит им tour_version = 1.
 */
export function shouldAutoStartTour(input: { onboardedAt: Date | null; completedVersion: number }, current: number = TOUR_VERSION): boolean {
  return input.onboardedAt !== null && input.completedVersion < current;
}
