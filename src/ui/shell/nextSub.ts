'use client';
// П.4 (t281u): вкладка «Что дальше» открывает последнюю подвкладку (Бэклог / План / Подскажи), а не всегда Бэклог.
import { useEffect, useSyncExternalStore } from 'react';
import { BACKLOG_SUBNAV } from '../tokens';
import { isSubnavActive } from './nav';

export const NEXT_SUB_KEY = 'ps-next-sub';
const SUBS: readonly string[] = BACKLOG_SUBNAV.map((s) => s.href);

/** Подвкладка группы по пути или null (вне группы). */
export function subOf(pathname: string): string | null {
  return SUBS.find((h) => isSubnavActive(pathname, h)) ?? null;
}

export function readNextSub(): string | null {
  try {
    const v = localStorage.getItem(NEXT_SUB_KEY);
    return v && SUBS.includes(v) ? v : null;
  } catch { return null; }
}

const listeners = new Set<() => void>();
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** href вкладки: для «Что дальше» — запомненная подвкладка. До гидрации и без памяти — обычный href (без расхождения SSR). */
export function useTabHref(pathname: string): (tab: { id: string; href: string }) => string {
  const sub = useSyncExternalStore(subscribe, readNextSub, () => null);
  useEffect(() => {
    const cur = subOf(pathname);
    if (!cur || readNextSub() === cur) return;
    try { localStorage.setItem(NEXT_SUB_KEY, cur); } catch { /* приватный режим */ }
    listeners.forEach((fn) => fn());
  }, [pathname]);
  return (tab) => (tab.id === 'backlog' && sub ? sub : tab.href);
}
