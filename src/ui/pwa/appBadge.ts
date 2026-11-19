'use client';
// Идея 4 (аудит UX): бейдж на иконке установленного приложения — сколько игр ждут «Разбора» (статус не задан),
// то же число, что у пункта «Разбор» в меню. Badging API: iOS 16.4+ (нужно разрешение на уведомления), Android Chrome,
// десктопные PWA. Нет API, не установлено или нет разрешения — молча ничего.
import { useEffect, useRef, useState } from 'react';
import { fetchSummary } from '../collection/api';
import { useDataRefresh } from '../shell/refresh';
import { useSync } from '../sync/SyncProvider';

type BadgeNav = { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void>; standalone?: boolean };

/** Что поставить на иконку: число > 0 или null (снять бейдж). */
export function badgeValue(none: number | null | undefined): number | null {
  return typeof none === 'number' && Number.isFinite(none) && none > 0 ? Math.floor(none) : null;
}

export function badgeSupported(nav: BadgeNav, standalone: boolean): boolean {
  return standalone && typeof nav.setAppBadge === 'function' && typeof nav.clearAppBadge === 'function';
}

export async function applyBadge(nav: BadgeNav, v: number | null): Promise<void> {
  try {
    if (v === null) await nav.clearAppBadge?.();
    else await nav.setAppBadge?.(v);
  } catch { /* нет разрешения на уведомления (iOS) — без бейджа */ }
}

/** Один на приложение (AppShell): при открытии, «потяни-обновить», возврате, своих правках и после синка. */
export function useAppBadge(): void {
  const [tick, setTick] = useState(0);
  useDataRefresh(() => setTick((t) => t + 1));
  const running = useSync().status?.running ?? false;
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) setTick((t) => t + 1);
    wasRunning.current = running;
  }, [running]);

  useEffect(() => {
    const nav = navigator as Navigator & BadgeNav;
    const standalone = nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (!badgeSupported(nav, standalone)) return;
    let live = true;
    fetchSummary().then((s) => { if (live) void applyBadge(nav, badgeValue(s.counts.none)); }, () => {});
    return () => { live = false; };
  }, [tick]);
}
