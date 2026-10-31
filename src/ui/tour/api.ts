// Клиент /api/me/tour (контракт docs/api-contract.md §23). Любая ошибка не бросается: тур fail-open.
import { TOUR_VERSION } from '@/shared/tour';
import { TOUR_SEEN_KEY, TOUR_STEP_KEY } from './model';
import { TOUR_STEPS } from './steps';

export type TourApiState = { version: number; completedVersion: number; shouldAutoStart: boolean };

async function parse(res: Response): Promise<TourApiState | null> {
  if (!res.ok) return null; // 401, 5xx (в т.ч. миграция 0016 ещё не применена): тур просто не работает через сервер
  const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: Partial<TourApiState> } | null;
  const d = json?.ok ? json.data : null;
  if (!d || typeof d.version !== 'number' || typeof d.completedVersion !== 'number' || typeof d.shouldAutoStart !== 'boolean') return null;
  return { version: d.version, completedVersion: d.completedVersion, shouldAutoStart: d.shouldAutoStart };
}

export async function fetchTourState(signal?: AbortSignal): Promise<TourApiState | null> {
  try {
    return await parse(await fetch('/api/me/tour', { cache: 'no-store', signal }));
  } catch {
    return null;
  }
}

/** done: true, version. Возвращает true при успехе; при неудаче ставит локальный запасной флаг, чтобы автозапуск не повторялся. */
export async function saveTourDone(version: number): Promise<boolean> {
  try {
    const res = await fetch('/api/me/tour', {
      method: 'PUT', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: true, version }),
    });
    if (res.ok) return true;
  } catch {
    // сеть: ниже запасной флаг
  }
  try { localStorage.setItem(TOUR_SEEN_KEY, String(version)); } catch { /* приватный режим: тур может показаться ещё раз */ }
  return false;
}

/** Онбординг, «Начать тур»: кладёт первый шаг в sessionStorage, TourProvider на `/` подхватит его как возобновление. */
export function queueTourStart(): void {
  try { sessionStorage.setItem(TOUR_STEP_KEY, TOUR_STEPS[0].id); } catch { /* без хранилища тур не стартует, сайт работает */ }
}

/** Онбординг, «Пропустить»: статус сохраняется в фоне, ошибка не мешает переходу. */
export function skipTourSilently(): void {
  void saveTourDone(TOUR_VERSION);
}
