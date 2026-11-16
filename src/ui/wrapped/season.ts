// Сезон «Итоги года» (docs/design-system.md §8.1): баннер и точка на вкладке «Статистика» в декабре и январе (МСК).
import { wrappedHiddenCookie, wrappedSeason } from '@/shared/wrapped-season';
import { readProfileValue, subscribeProfileScope, writeProfileValue } from '../profiles/scope';

/** Год, чьи итоги предлагаем: декабрь = текущий год, январь = прошлый; вне сезона null. */
export function seasonYear(nowMs: number): number | null {
  return wrappedSeason(nowMs)?.year ?? null;
}

/** Итоги ещё предварительные: декабрь, год не закончился (по МСК). */
export const seasonPreliminary = (nowMs: number): boolean => wrappedSeason(nowMs)?.preliminary ?? false;

export const wrappedHiddenKey = (year: number) => `ps-wbanner-hidden-${year}`;

const EVENT = 'ps-wbanner-change';

export function isSeasonHidden(year: number): boolean {
  return readProfileValue(wrappedHiddenKey(year)) === '1';
}

/** Закрыть баннер года (✕) или открыть Итоги: баннер и точка до следующего сезона не возвращаются. */
export function hideSeason(year: number): void {
  writeProfileValue(wrappedHiddenKey(year), '1'); // ключ с id активного профиля; без хранилища до перезагрузки
  syncHiddenCookie(year);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

export function subscribeSeason(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  const off = subscribeProfileScope(cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', cb); off(); };
}

/** П8.4: тот же факт в cookie, чтобы сервер не рисовал баннер на главной (иначе он пропадал бы после гидрации). */
export function syncHiddenCookie(year: number): void {
  if (typeof document !== 'undefined') document.cookie = wrappedHiddenCookie(year);
}
