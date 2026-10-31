// Версия интерактивного тура (контракт 23.1). Менять вручную, когда тур нужно показать всем ещё раз.
export const TOUR_VERSION = 1;

/**
 * Автозапуск тура (контракт 23.3): онбординг пройден (или это owner, у которого онбординга нет)
 * и пройденная версия ниже текущей.
 */
export function shouldAutoStartTour(input: { role: 'owner' | 'member'; onboardedAt: Date | null; completedVersion: number }, current: number = TOUR_VERSION): boolean {
  return (input.role === 'owner' || input.onboardedAt !== null) && input.completedVersion < current;
}
