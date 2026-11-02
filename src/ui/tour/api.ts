// Клиент /api/me/tour (контракт docs/api-contract.md §23). Любая ошибка не бросается: тур fail-open.
import { TOUR_VERSION } from '@/shared/tour';
import { registerCacheReset, writeProfileValue } from '../profiles/scope';
import { TOUR_SEEN_KEY, TOUR_STEP_KEY } from './model';
import { TOUR_STEPS } from './steps';

// Смена профиля PSN: недопройденный тур прежнего профиля не возобновляется у нового
registerCacheReset(() => { try { sessionStorage.removeItem(TOUR_STEP_KEY); } catch { /* нет хранилища */ } });

export type TourApiState = { version: number; completedVersion: number; shouldAutoStart: boolean };

async function parse(res: Response): Promise<TourApiState | null> {
  if (!res.ok) return null; // 401, 5xx (в т.ч. миграция 0016 ещё не применена): тур просто не работает через сервер
  const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: Partial<TourApiState> } | null;
  const d = json?.ok ? json.data : null;
  if (!d || typeof d.version !== 'number' || typeof d.completedVersion !== 'number' || typeof d.shouldAutoStart !== 'boolean') return null;
  return { version: d.version, completedVersion: d.completedVersion, shouldAutoStart: d.shouldAutoStart };
}

// Тур и «Что нового» спрашивают состояние на одной загрузке: один общий запрос, ответ живёт TOUR_STATE_TTL_MS
// (сбрасывается при сохранении прохождения и смене профиля).
const TOUR_STATE_TTL_MS = 10_000;
let shared: { at: number; p: Promise<TourApiState | null> } | null = null;
registerCacheReset(() => { shared = null; });

function sharedTourState(): Promise<TourApiState | null> {
  if (!shared || Date.now() - shared.at > TOUR_STATE_TTL_MS) {
    const p = fetch('/api/me/tour', { cache: 'no-store' }).then(parse).catch(() => null);
    const entry = { at: Date.now(), p };
    shared = entry;
    void p.then((v) => { if (v === null && shared === entry) shared = null; }); // сбой не кэшируем
  }
  return shared.p;
}

export async function fetchTourState(signal?: AbortSignal): Promise<TourApiState | null> {
  if (signal?.aborted) return null;
  const v = await sharedTourState();
  return signal?.aborted ? null : v;
}

/** done: true, version. Возвращает true при успехе; при неудаче ставит локальный запасной флаг, чтобы автозапуск не повторялся. */
export async function saveTourDone(version: number): Promise<boolean> {
  shared = null;
  try {
    const res = await fetch('/api/me/tour', {
      method: 'PUT', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: true, version }),
    });
    if (res.ok) return true;
  } catch {
    // сеть: ниже запасной флаг
  }
  writeProfileValue(TOUR_SEEN_KEY, String(version)); // приватный режим: тур может показаться ещё раз
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
