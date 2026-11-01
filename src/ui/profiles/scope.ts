'use client';

// Область активного профиля PSN на клиенте (Фаза 41): id для ключей хранилища и сброс кэшей при смене профиля.
// Модульное состояние (не контекст), чтобы им пользовались и обычные функции (view.ts, season.ts, tour/api.ts).
import { scopedKey } from './model';

let activeId: number | null = null;
const listeners = new Set<() => void>();
const resetters = new Set<() => void>();

export const getActiveProfileId = (): number | null => activeId;

export function setActiveProfileId(id: number | null): void {
  if (id === activeId) return;
  activeId = id;
  listeners.forEach((l) => l());
}

/** Для useSyncExternalStore: пересчитать значения из хранилища, когда id профиля стал известен или сменился. */
export function subscribeProfileScope(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Модуль с собственным кэшем регистрирует сброс; вызывается при смене профиля до показа новых данных. */
export function registerCacheReset(fn: () => void): () => void {
  resetters.add(fn);
  return () => { resetters.delete(fn); };
}

export function resetClientCaches(): void {
  resetters.forEach((fn) => { try { fn(); } catch { /* сброс одного кэша не должен ломать остальные */ } });
}

export const profileKey = (base: string): string => scopedKey(base, activeId);

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const local = (): Store | null => { try { return localStorage; } catch { return null; } };
const session = (): Store | null => { try { return sessionStorage; } catch { return null; } };

/** Чтение значения профиля. `legacy`: пока для профиля ничего не сохранено, берётся прежний общий ключ (настройки до Фазы 41). */
export function readProfileValue(base: string, opts: { legacy?: boolean; session?: boolean } = {}): string | null {
  const s = opts.session ? session() : local();
  if (!s) return null;
  try {
    const own = s.getItem(profileKey(base));
    if (own !== null || !opts.legacy || activeId === null) return own;
    return s.getItem(base);
  } catch { return null; }
}

export function writeProfileValue(base: string, value: string, opts: { session?: boolean } = {}): void {
  try { (opts.session ? session() : local())?.setItem(profileKey(base), value); } catch { /* приватный режим */ }
}

export function removeProfileValue(base: string, opts: { session?: boolean } = {}): void {
  try { (opts.session ? session() : local())?.removeItem(profileKey(base)); } catch { /* приватный режим */ }
}
