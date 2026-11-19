// Запуск PWA без чёрного кадра: заставка .ps-boot (тот же кадр, что apple-touch-startup-image) держится, пока раздел не готов
// (data-tour-ready="true" у страницы), затем короткий crossfade. Чистая логика решения — в bootReady (Vitest).

/** Не дольше: дальше заставка уходит, даже если данные ещё грузятся (скелет). */
export const BOOT_MAX_MS = 4000;
/** Страница без маркера готовности (вход, офлайн): ждём столько, чтобы раздел успел смонтироваться. */
export const BOOT_NO_MARKER_MS = 600;
/** Длительность crossfade заставки → приложение. */
export const BOOT_FADE_MS = 220;

export type BootProbe = { hasPage: boolean; pageReady: boolean; elapsed: number };

export function bootReady({ hasPage, pageReady, elapsed }: BootProbe): boolean {
  if (elapsed >= BOOT_MAX_MS) return true;
  if (hasPage) return pageReady;
  return elapsed >= BOOT_NO_MARKER_MS;
}

/** Заставка видна только в установленном PWA (класс от theme-script или display-mode). */
function bootVisible(): boolean {
  const el = document.querySelector('.ps-boot');
  return !!el && getComputedStyle(el).display !== 'none';
}

/** Запуск после гидратации: ждём готовности раздела по кадрам, потом fade (или сразу при reduced motion). */
export function releaseBoot(): () => void {
  const root = document.documentElement;
  if (!bootVisible()) { root.setAttribute('data-booted', ''); return () => {}; }
  const t0 = performance.now();
  let raf = 0;
  let timer = 0;
  const tick = () => {
    const page = document.querySelector('[data-tour-page]');
    const ok = bootReady({ hasPage: !!page, pageReady: page?.getAttribute('data-tour-ready') === 'true', elapsed: performance.now() - t0 });
    if (!ok) { raf = requestAnimationFrame(tick); return; }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // кадр с готовым содержимым под заставкой, затем fade: содержимое не «выскакивает» и нет пустого кадра
    raf = requestAnimationFrame(() => {
      if (reduce) { root.setAttribute('data-booted', ''); return; }
      root.setAttribute('data-boot-fade', '');
      timer = window.setTimeout(() => root.setAttribute('data-booted', ''), BOOT_FADE_MS + 40);
    });
  };
  raf = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(raf); window.clearTimeout(timer); };
}
