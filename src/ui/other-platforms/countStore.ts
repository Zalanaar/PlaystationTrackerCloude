'use client';

import { useSyncExternalStore } from 'react';
import { registerCacheReset } from '../profiles/scope';

// Число записей для пункта меню профиля (19c.1): известно только после загрузки экрана, иначе меню без числа.
let count: number | null = null;
const subs = new Set<() => void>();

export function setOtherCount(n: number | null) {
  if (count === n) return;
  count = n;
  subs.forEach((f) => f());
}
const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
export const useOtherCount = (): number | null => useSyncExternalStore(subscribe, () => count, () => null);
registerCacheReset(() => setOtherCount(null));
