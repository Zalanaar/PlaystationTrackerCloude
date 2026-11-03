'use client';

import { useSyncExternalStore } from 'react';

function subscribeMq(query: string) {
  return (cb: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener('change', cb);
    return () => mq.removeEventListener('change', cb);
  };
}

/** Медиазапрос без рассинхрона гидратации: на сервере всегда false. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => subscribeMq(query)(cb),
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsMobile = () => useMediaQuery('(max-width: 767px)');

/**
 * Как useIsMobile, но на сервере и при гидрации null («ещё неизвестно»).
 * Для разметки, которая рендерится на сервере: вместо десктопной версии (сдвиг на телефоне) рисуем адаптивный скелет.
 */
export function useIsMobileOrUnknown(): boolean | null {
  const q = '(max-width: 767px)';
  return useSyncExternalStore<boolean | null>(
    (cb) => subscribeMq(q)(cb),
    () => window.matchMedia(q).matches,
    () => null,
  );
}

/** Текущее время, обновляется раз в минуту (для «3 ч назад»). */
export function useNow(intervalMs = 60_000, serverNow = 0): number {
  return useSyncExternalStore(
    (cb) => {
      const t = setInterval(cb, intervalMs);
      return () => clearInterval(t);
    },
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    // serverNow: время серверного рендера (item 4), иначе 0 = «время неизвестно»
    () => serverNow,
  );
}

/** Ширина окна (для числа колонок превью). На сервере serverWidth (подсказка из cookie, item 4), иначе 1440. */
export function useViewportWidth(serverWidth = 1440): number {
  return useSyncExternalStore(
    (cb) => { window.addEventListener('resize', cb); return () => window.removeEventListener('resize', cb); },
    () => window.innerWidth,
    () => serverWidth,
  );
}
