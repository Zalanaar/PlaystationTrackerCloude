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

/** Текущее время, обновляется раз в минуту (для «3 ч назад»). */
export function useNow(intervalMs = 60_000): number {
  return useSyncExternalStore(
    (cb) => {
      const t = setInterval(cb, intervalMs);
      return () => clearInterval(t);
    },
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => 0,
  );
}
