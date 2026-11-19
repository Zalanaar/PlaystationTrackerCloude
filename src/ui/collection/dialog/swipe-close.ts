// П15.2: свайп вниз закрывает окно игры на телефоне. Только когда содержимое прокручено к самому верху
// и жест явно вертикальный; поля ввода, ползунки и горизонтальные ряды не перехватываем.
// Touch-события (не pointer): в Safari на iPhone pointercancel приходит, как только браузер начинает свою прокрутку.

export const SWIPE_CLOSE_PX = 110;      // дальше — закрываем
export const SWIPE_FLICK_PX = 50;       // короткий, но быстрый жест тоже закрывает
export const SWIPE_FLICK_SPEED = 0.6;   // px/мс
const DECIDE_PX = 10;

const SKIP = 'input, textarea, select, [contenteditable="true"], [role="slider"], [data-no-swipe]';

/** Решение по концу жеста (чистая функция — тестируется отдельно). */
export function shouldClose(dy: number, ms: number): boolean {
  if (dy >= SWIPE_CLOSE_PX) return true;
  return dy >= SWIPE_FLICK_PX && ms > 0 && dy / ms >= SWIPE_FLICK_SPEED;
}

function scrollsSideways(el: Element | null, stop: Element): boolean {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

export function attachSwipeClose(root: HTMLElement, scroller: HTMLElement, close: () => void): () => void {
  const mq = window.matchMedia('(max-width: 767px)');
  let startX = 0, startY = 0, t0 = 0, dy = 0;
  let state: 'idle' | 'maybe' | 'drag' | 'off' = 'idle';

  const reset = (animate: boolean) => {
    root.style.transition = animate ? 'transform var(--dur-base, 200ms) var(--ease-out, ease-out)' : '';
    root.style.transform = '';
    if (animate) window.setTimeout(() => { root.style.transition = ''; }, 260);
  };

  const onStart = (e: TouchEvent) => {
    state = 'off';
    if (!mq.matches || e.touches.length !== 1) return;
    const t = e.target instanceof Element ? e.target : null;
    if (!t || t.closest(SKIP) || scrollsSideways(t, root)) return;
    if (scroller.scrollTop > 0) return;
    // поверх окна открыт sheet (статус и др.) — жест его, а не окна
    const modals = document.querySelectorAll('[aria-modal="true"]');
    if (modals[modals.length - 1] !== root) return;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY; t0 = e.timeStamp; dy = 0;
    state = 'maybe';
  };

  const onMove = (e: TouchEvent) => {
    if (state !== 'maybe' && state !== 'drag') return;
    const x = e.touches[0].clientX - startX;
    const y = e.touches[0].clientY - startY;
    if (state === 'maybe') {
      if (Math.abs(x) < DECIDE_PX && Math.abs(y) < DECIDE_PX) return;
      if (y <= 0 || Math.abs(x) > Math.abs(y) || scroller.scrollTop > 0) { state = 'off'; return; }
      state = 'drag';
      root.style.transition = 'none';
    }
    e.preventDefault(); // своя прокрутка/«резинка» не нужна, пока тянем окно
    dy = Math.max(0, y);
    root.style.transform = `translateY(${dy}px)`;
  };

  const onEnd = (e: TouchEvent) => {
    if (state !== 'drag') { state = 'idle'; return; }
    state = 'idle';
    if (!shouldClose(dy, e.timeStamp - t0)) { reset(true); return; }
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) { reset(false); close(); return; }
    root.style.transition = 'transform var(--dur-base, 200ms) var(--ease-out, ease-out)';
    root.style.transform = 'translateY(100%)';
    window.setTimeout(close, 180);
  };

  const onCancel = () => { if (state === 'drag') reset(true); state = 'idle'; };

  root.addEventListener('touchstart', onStart, { passive: true });
  root.addEventListener('touchmove', onMove, { passive: false });
  root.addEventListener('touchend', onEnd);
  root.addEventListener('touchcancel', onCancel);
  return () => {
    root.removeEventListener('touchstart', onStart);
    root.removeEventListener('touchmove', onMove);
    root.removeEventListener('touchend', onEnd);
    root.removeEventListener('touchcancel', onCancel);
  };
}
