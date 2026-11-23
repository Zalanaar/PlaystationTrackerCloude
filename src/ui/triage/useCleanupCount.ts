'use client';

import { useEffect, useState } from 'react';
import { fetchBacklogAge } from '../collection/api';

/** Число кандидатов «Чистки бэклога». null = ещё не известно или сбой: чип не показываем, кроме активного режима. */
export function useCleanupCount(): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchBacklogAge().then(
      (r) => {
        if (!alive) return;
        const v = r.summary.cleanup;
        setN(typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
      },
      () => { if (alive) setN(null); },
    );
    return () => { alive = false; };
  }, []);
  return n;
}

export const cleanupSegmentText = (n: number) => `Чистка ${n}`;
