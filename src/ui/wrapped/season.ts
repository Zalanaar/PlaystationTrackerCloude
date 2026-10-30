// Сезон «Итоги года» (docs/design-system.md §8.1): баннер и точка на вкладке «Статистика» в декабре и январе (МСК).
import { WRAPPED_BANNER_MONTHS } from '../tokens';
import { mskParts } from '../format';

/** Год, чьи итоги предлагаем: декабрь = текущий год, январь = прошлый; вне сезона null. */
export function seasonYear(nowMs: number): number | null {
  if (!nowMs) return null;
  const { y, m } = mskParts(nowMs);
  if (!(WRAPPED_BANNER_MONTHS as readonly number[]).includes(m)) return null;
  return m === 1 ? y - 1 : y;
}

export const wrappedHiddenKey = (year: number) => `ps-wbanner-hidden-${year}`;

const EVENT = 'ps-wbanner-change';

export function isSeasonHidden(year: number): boolean {
  try { return localStorage.getItem(wrappedHiddenKey(year)) === '1'; } catch { return false; }
}

/** Закрыть баннер года (✕) или открыть Итоги: баннер и точка до следующего сезона не возвращаются. */
export function hideSeason(year: number): void {
  try { localStorage.setItem(wrappedHiddenKey(year), '1'); } catch { /* приватный режим: до перезагрузки */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

export function subscribeSeason(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', cb); };
}
