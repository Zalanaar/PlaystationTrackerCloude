// Версия интерактивного тура (контракт 23.1). Менять вручную, когда тур нужно показать всем ещё раз.
export const TOUR_VERSION = 2;

/**
 * Автозапуск тура (контракт 23.3): онбординг пройден и пройденная версия ниже текущей.
 * Существующим пользователям миграция 0016 поставила tour_version = 1. Версия 2 — новый тур (синк → Разбор → Играю → Пройдено → оценка → итоги): покажем его один раз тем, кто прошёл только v1.
 */
export function shouldAutoStartTour(input: { onboardedAt: Date | null; completedVersion: number }, current: number = TOUR_VERSION): boolean {
  return input.onboardedAt !== null && input.completedVersion < current;
}
