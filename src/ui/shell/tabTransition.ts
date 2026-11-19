// П11.5.3: «нативная» смена вкладок на телефоне. Чистые функции (тестируются в Vitest) + запуск View Transition.
// Старый экран остаётся снимком, пока новый раздел не смонтирован; шапка и нижняя панель исключены из анимации (view-transition-name).

/** Направление сдвига: вкладка правее — новый экран въезжает справа. */
export function navDir(from: number, to: number): 'fwd' | 'back' {
  return to >= from ? 'fwd' : 'back';
}

/** Клик, который перехватываем: левая кнопка без модификаторов, на другую вкладку. */
export function shouldIntercept(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }, from: number, to: number): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && from >= 0 && to >= 0 && from !== to;
}

/** Позиция прокрутки по вкладке на время сессии. */
const KEY = 'ps-tab-scroll';
export function readScroll(store: Pick<Storage, 'getItem'> | null, tab: string): number {
  try {
    const v = JSON.parse(store?.getItem(KEY) ?? '{}')[tab];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  } catch { return 0; }
}
export function writeScroll(store: Pick<Storage, 'getItem' | 'setItem'> | null, tab: string, y: number): void {
  try {
    const all = JSON.parse(store?.getItem(KEY) ?? '{}');
    all[tab] = Math.max(0, Math.round(y));
    store?.setItem(KEY, JSON.stringify(all));
  } catch { /* приватный режим: без запоминания */ }
}

/**
 * Ждать новый экран не дольше: дальше снимок отпускается, даже если раздел ещё грузится (скелет той же раскладки).
 * П16.2: было 800 мс — на iPhone экран «замирал» на 200–400 мс до начала анимации; разделы и данные теперь грузятся заранее.
 */
export const VT_MAX_WAIT_MS = 150;
/** Метки Performance API: касание вкладки и старт анимации (замер задержки в e2e). */
export const MARK_TAP = 'ps-tab-tap';
export const MARK_VT = 'ps-tab-vt-start';
export const MEASURE_TAB = 'ps-tab-delay';
export const TAB_VT_MS = 280;

type VT = { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void> };
type VTDoc = Document & { startViewTransition?: (cb: () => Promise<void>) => VT };
let seq = 0;

/** Можно ли анимировать: телефон, API есть, движение не отключено. */
export function canViewTransition(): boolean {
  if (typeof window === 'undefined') return false;
  const d = document as VTDoc;
  return typeof d.startViewTransition === 'function' && matchMedia('(max-width: 767px)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Переход с View Transition: navigate() меняет маршрут, ready — промис «новый экран смонтирован и прокрутка восстановлена».
 * Без API (или reduced motion) — обычный переход (в шаблоне остаётся мягкий fade).
 */
export function runTabTransition(dir: 'fwd' | 'back', navigate: () => void, ready: () => Promise<void>): void {
  const root = document.documentElement;
  if (!canViewTransition()) { navigate(); return; }
  const id = ++seq;
  root.setAttribute('data-vt', '');
  root.setAttribute('data-nav-dir', dir);
  // атрибуты снимает только последний переход (быстрый второй тап пропускает первый)
  const done = () => { if (id !== seq) return; root.removeAttribute('data-vt'); root.removeAttribute('data-nav-dir'); };
  try {
    const t = (document as VTDoc).startViewTransition!(() => {
      navigate();
      return Promise.race([ready(), new Promise<void>((r) => setTimeout(r, VT_MAX_WAIT_MS))]);
    });
    const quiet = () => {};
    t.ready.catch(quiet); t.updateCallbackDone.catch(quiet); // пропущенный переход отклоняет промисы — это не ошибка
    t.ready.then(() => {
      try { performance.mark(MARK_VT); performance.measure(MEASURE_TAB, MARK_TAP, MARK_VT); } catch { /* метки необязательны */ }
    }, quiet);
    t.finished.then(done, done);
  } catch { done(); navigate(); }
}
