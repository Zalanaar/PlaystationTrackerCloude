'use client';
// П9 эксперимент «Трофеи» вместо «Разбор» во вкладках: сколько игр ждут разбора (статус не задан) — бейдж у пункта «Разбор» в меню.
// Источник — сводка Коллекции (кеш 30 с, тот же запрос, что у Коллекции), обновляется при «потяни-обновить» и возврате в приложение.
import { useEffect, useState } from 'react';
import { fetchSummary } from '../collection/api';
import { useDataRefresh } from './refresh';

/** Текст бейджа: пусто при 0 и неизвестном, «99+» для больших чисел. */
export function pendingBadge(n: number | null | undefined): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  return n > 99 ? '99+' : String(Math.floor(n));
}

/** active: меню открыто (запрос только тогда, сводка обычно уже в кеше). */
export function useTriagePending(active: boolean): number | null {
  const [n, setN] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  useDataRefresh(() => setTick((t) => t + 1));
  useEffect(() => {
    if (!active) return;
    let live = true;
    fetchSummary().then((s) => { if (live) setN(s.counts.none); }, () => {});
    return () => { live = false; };
  }, [active, tick]);
  return n;
}
