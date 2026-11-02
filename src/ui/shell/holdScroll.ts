/**
 * Удержать прокрутку окна на `y` после закрытия окна игры.
 * Пока страница ниже нужного (данные ещё грузятся) или `ready()` ложно, ждём до 4 с; затем ещё 600 мс возвращаем `y`,
 * если её сбили (восстановление прокрутки браузером, перерисовка списка). Любое действие пользователя (касание, колесо, клавиша) прекращает удержание.
 * `onApplied` вызывается после первой установки прокрутки. Возвращает функцию отмены.
 */
export function holdScroll(y: number, ready: () => boolean = () => true, onApplied?: () => void): () => void {
  const start = performance.now();
  let appliedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const tall = () => document.documentElement.scrollHeight - window.innerHeight >= y - 1;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const ev of EVENTS) window.removeEventListener(ev, stop, true);
  };
  const tick = () => {
    timer = null;
    if (stopped) return;
    const now = performance.now();
    if (!appliedAt) {
      if (tall() && ready()) {
        if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
        appliedAt = now;
        onApplied?.();
      } else if (now - start > 4000) { stop(); return; }
    } else {
      if (now - appliedAt > 600) { stop(); return; }
      if (Math.abs(window.scrollY - y) > 1 && tall()) window.scrollTo(0, y);
    }
    // таймер, а не requestAnimationFrame: кадры могут не идти (фоновая вкладка, WebKit под открытым окном)
    timer = setTimeout(tick, 16);
  };
  for (const ev of EVENTS) window.addEventListener(ev, stop, true);
  tick();
  return stop;
}

const EVENTS = ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const;
