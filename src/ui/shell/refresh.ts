// П9: «обновить данные» без перезагрузки: возврат в приложение (PWA) и «потяни, чтобы обновить».
// Кэш GET сбрасывается, экраны слушают событие и тихо перечитывают свои данные (без скелетов и сдвига прокрутки).
import { useEffect, useRef } from 'react';
import { invalidateApiCache } from '../data/http';

export const DATA_REFRESH_EVENT = 'ps:data-refresh';
/** Сколько вкладка должна пробыть скрытой, чтобы при возврате перечитать данные (короткое переключение — не повод). */
export const RETURN_REFRESH_AFTER_MS = 2 * 60_000;

export type RefreshReason = 'return' | 'pull';

export function requestDataRefresh(reason: RefreshReason): void {
  invalidateApiCache();
  window.dispatchEvent(new CustomEvent<RefreshReason>(DATA_REFRESH_EVENT, { detail: reason }));
}

/** Возврат после долгого отсутствия: скрыта была не меньше порога. */
export function shouldRefreshOnReturn(hiddenAt: number | null, now: number): boolean {
  return hiddenAt !== null && now - hiddenAt >= RETURN_REFRESH_AFTER_MS;
}

/** Экран подписывается: обработчик берётся последний, без переподписки. */
export function useDataRefresh(handler: (reason: RefreshReason) => void): void {
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });
  useEffect(() => {
    const on = (e: Event) => ref.current((e as CustomEvent<RefreshReason>).detail);
    window.addEventListener(DATA_REFRESH_EVENT, on);
    return () => window.removeEventListener(DATA_REFRESH_EVENT, on);
  }, []);
}

/** Один на приложение (AppShell): следит за видимостью вкладки и шлёт обновление при долгом возвращении. */
export function useRefreshOnReturn(): void {
  useEffect(() => {
    let hiddenAt: number | null = document.hidden ? Date.now() : null;
    const on = () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (shouldRefreshOnReturn(hiddenAt, Date.now())) requestDataRefresh('return');
      hiddenAt = null;
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
}

// ---------- потяни, чтобы обновить ----------
/** Сколько протянуть (px, после сопротивления), чтобы отпускание обновило. */
export const PULL_TRIGGER_PX = 64;
export const PULL_MAX_PX = 96;

/** Сопротивление: палец 0..∞ → индикатор 0..PULL_MAX_PX (половина хода, дальше насыщение). */
export function pullDistance(dy: number): number {
  if (dy <= 0) return 0;
  const d = dy * 0.5;
  return d <= PULL_TRIGGER_PX ? d : Math.min(PULL_MAX_PX, PULL_TRIGGER_PX + (d - PULL_TRIGGER_PX) * 0.4);
}
