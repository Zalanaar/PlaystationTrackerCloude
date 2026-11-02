'use client';

import { useSyncExternalStore } from 'react';

/** Развёрнут ли блок «Ближе всего к платине» на мобильном (по умолчанию свёрнут, чтобы игры были выше сгиба). */
export const NEAR_OPEN_KEY = 'ps-near-open';
const EVENT = 'ps-near-open-change';

function read(): boolean {
  try { return localStorage.getItem(NEAR_OPEN_KEY) === '1'; } catch { return false; }
}

export function useNearOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb); window.addEventListener('storage', cb);
      return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', cb); };
    },
    read,
    () => false,
  );
}

export function storeNearOpen(open: boolean): void {
  try { localStorage.setItem(NEAR_OPEN_KEY, open ? '1' : '0'); } catch { /* приватный режим: только до перезагрузки не запомним */ }
  window.dispatchEvent(new Event(EVENT));
}
