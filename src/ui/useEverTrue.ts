'use client';

import { useState } from 'react';

/**
 * true с первого раза, когда v стал true, и дальше навсегда (Пакет 6, JS главной).
 * Ленивые окна (next/dynamic) монтируем только после первого открытия: их чанк не качается при загрузке страницы,
 * а после первого открытия окно остаётся смонтированным и закрывается со своей анимацией.
 */
export function useEverTrue(v: boolean): boolean {
  const [ever, setEver] = useState(v);
  if (v && !ever) setEver(true);
  return ever || v;
}
