'use client';

import { useCallback, useRef, type PointerEvent } from 'react';

export const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;

/** Долгий тап. После срабатывания следующий click подавляется (wasLong). */
export function useLongPress(onLong: () => void, enabled: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      if (!enabled) return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        timer.current = null;
        onLong();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE_PX) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: { preventDefault(): void }) => { if (enabled) e.preventDefault(); },
  };
  /** true, если только что сработал долгий тап: click нужно проигнорировать */
  const wasLong = () => {
    const v = fired.current;
    fired.current = false;
    return v;
  };
  return { handlers, wasLong };
}
