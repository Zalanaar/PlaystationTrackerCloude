// Фаза 42B: логика показа лоадера. Чистая (без React), тестируется на fake timers.
// Правило: оверлей появляется, только если загрузка длится дольше SHOW_DELAY_MS; после появления висит не меньше MIN_SHOW_MS.

export const LOADER_SHOW_DELAY_MS = 200;
export const LOADER_MIN_SHOW_MS = 400;

export interface LoaderGate {
  /** Сообщить, идёт ли сейчас загрузка. Повторные вызовы с тем же значением безопасны. */
  set(loading: boolean): void;
  /** Остановить таймеры (размонтирование). */
  dispose(): void;
}

export function createLoaderGate(
  onChange: (visible: boolean) => void,
  opts: { delay?: number; minShow?: number; now?: () => number } = {},
): LoaderGate {
  const delay = opts.delay ?? LOADER_SHOW_DELAY_MS;
  const minShow = opts.minShow ?? LOADER_MIN_SHOW_MS;
  const now = opts.now ?? (() => Date.now());
  let visible = false;
  let shownAt = 0;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const hide = () => { hideTimer = null; visible = false; onChange(false); };

  return {
    set(loading) {
      if (loading) {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } // загрузка возобновилась, пока доживал минимум
        if (!visible && !showTimer) {
          showTimer = setTimeout(() => { showTimer = null; visible = true; shownAt = now(); onChange(true); }, delay);
        }
        return;
      }
      if (showTimer) { clearTimeout(showTimer); showTimer = null; return; } // быстрая загрузка: не показывали вовсе
      if (visible && !hideTimer) {
        const left = minShow - (now() - shownAt);
        if (left <= 0) hide(); else hideTimer = setTimeout(hide, left);
      }
    },
    dispose() {
      if (showTimer) { clearTimeout(showTimer); showTimer = null; }
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    },
  };
}
