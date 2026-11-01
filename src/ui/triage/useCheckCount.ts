'use client';

import { useEffect, useState } from 'react';
import { fetchStatusHintCount } from '../collection/api';

/** Число подсказок смены статуса (GET /api/status-hints/count). null = ещё не известно или сбой: чип не показываем. */
export function useCheckCount(): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchStatusHintCount().then((v) => { if (alive) setN(v); });
    return () => { alive = false; };
  }, []);
  return n;
}
