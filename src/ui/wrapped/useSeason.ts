'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useNow } from '../primitives/hooks';
import { isSeasonHidden, seasonYear, subscribeSeason, syncHiddenCookie } from './season';

/**
 * Год, для которого сейчас предлагаем Итоги (дек.–янв., МСК), если баннер не закрыт и Итоги этого года не открывали; иначе null.
 * ssrYear (П8.4, главная): год, который уже нарисовал сервер; до гидрации и во время неё берём его, чтобы баннер не появлялся после (CLS 0).
 */
export function useSeasonOffer(ssrYear: number | null = null): number | null {
  const now = useNow();
  const year = now ? seasonYear(now) : ssrYear;
  const hidden = useSyncExternalStore(subscribeSeason, () => year === null || isSeasonHidden(year), () => ssrYear === null);
  // закрыт раньше (до П8.4 или в другой вкладке), а cookie нет: дописать, чтобы сервер больше его не рисовал
  useEffect(() => {
    if (ssrYear !== null && year === ssrYear && hidden) syncHiddenCookie(ssrYear);
  }, [ssrYear, year, hidden]);
  return year !== null && !hidden ? year : null;
}
