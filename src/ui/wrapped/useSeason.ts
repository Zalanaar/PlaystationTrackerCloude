'use client';

import { useSyncExternalStore } from 'react';
import { useNow } from '../primitives/hooks';
import { isSeasonHidden, seasonYear, subscribeSeason } from './season';

/** Год, для которого сейчас предлагаем Итоги (дек.–янв., МСК), если баннер не закрыт и Итоги этого года не открывали; иначе null. */
export function useSeasonOffer(): number | null {
  const now = useNow();
  const year = seasonYear(now);
  const hidden = useSyncExternalStore(subscribeSeason, () => year === null || isSeasonHidden(year), () => true);
  return year !== null && !hidden ? year : null;
}
