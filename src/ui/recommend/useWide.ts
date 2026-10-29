'use client';

import { useSyncExternalStore } from 'react';

const WIDE = '(min-width: 1024px)';
const subscribeWide = (cb: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};
/** ≥1024: трёхколоночная сетка с вертикальными карточками (спека 3). */
export const useWide = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
