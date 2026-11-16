'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { PULL_TRIGGER_PX, pullDistance, requestDataRefresh } from './refresh';

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Касание внутри окна, шторки, поля ввода или горизонтальной ленты — не жест обновления страницы. */
function ignoredTarget(t: EventTarget | null): boolean {
  const el = t instanceof Element ? t : null;
  if (!el) return true;
  return !!el.closest('[role="dialog"], .ps-sheet, .ps-story, input, textarea, select, [contenteditable="true"], .ps-pop__panel');
}

/**
 * П9: «потяни, чтобы обновить» в установленном приложении (PWA). В standalone у iOS нет своего жеста, а прокрутка за край
 * выключена (overscroll-behavior: none). Тянем страницу вниз с самого верха: круг со стрелкой выезжает под шапкой,
 * после порога отпускание тихо перечитывает данные экрана (событие ps:data-refresh). В браузере ничего не делает.
 */
export function PullToRefresh() {
  const [busy, setBusy] = useState(false);
  const ind = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    let start: { x: number; y: number } | null = null;
    let dist = 0;
    let horizontal = false;
    const paint = (d: number, animate: boolean) => {
      const el = ind.current;
      if (!el) return;
      el.style.setProperty('--ptr', `${d}px`);
      el.style.setProperty('--ptr-p', String(Math.min(1, d / PULL_TRIGGER_PX)));
      el.toggleAttribute('data-animate', animate);
      el.toggleAttribute('data-ready', d >= PULL_TRIGGER_PX);
    };
    const onStart = (e: TouchEvent) => {
      start = null;
      if (busyRef.current || e.touches.length !== 1 || window.scrollY > 0 || !standalone()) return;
      if (document.body.style.overflow === 'hidden' || ignoredTarget(e.target)) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      dist = 0;
      horizontal = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || horizontal) return;
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (dist === 0 && Math.abs(dx) > Math.abs(dy)) { horizontal = true; return; }
      if (window.scrollY > 0) { start = null; paint(0, true); return; }
      dist = pullDistance(dy);
      paint(dist, false);
    };
    const onEnd = () => {
      if (!start) return;
      start = null;
      if (dist >= PULL_TRIGGER_PX) {
        busyRef.current = true;
        setBusy(true);
        paint(PULL_TRIGGER_PX, true);
        requestDataRefresh('pull');
        // данные экраны перечитывают сами; круг крутится коротко, чтобы жест имел ответ
        setTimeout(() => { busyRef.current = false; setBusy(false); paint(0, true); }, 900);
      } else paint(0, true);
      dist = 0;
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return (
    <>
      <div ref={ind} className="ps-ptr" data-busy={busy || undefined} data-testid="ptr" aria-hidden="true">
        <span className="ps-ptr__c"><Icon name="refresh" size={18} /></span>
      </div>
      <p className="ps-sr" aria-live="polite" data-testid="ptr-live">{busy ? 'Обновляем данные' : ''}</p>
    </>
  );
}
