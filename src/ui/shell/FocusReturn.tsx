'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { clearFocusOrigin, clearScrollOrigin, findFocusOrigin, peekFocusOrigin, peekScrollOrigin } from '../collection/useGameLink';
import { holdScroll } from './holdScroll';

/**
 * Возврат на страницу-источник после закрытия окна игры, открытого с другой страницы (R-1): прежняя прокрутка и фокус.
 * Прокрутка возвращается всегда, даже без источника фокуса (Safari на iPhone не фокусирует нажатую кнопку, Бэклог уезжал вниз).
 * Ждёт, пока страница загрузит данные (до 4 с); любое действие пользователя отменяет возврат. Фокус ставится без прокрутки.
 */
export function FocusReturn() {
  const pathname = usePathname();
  useEffect(() => {
    const o = peekFocusOrigin();
    const s = peekScrollOrigin();
    if (!o && !s) return;
    if (pathname === '/') return; // окно открыто на Коллекции, ждём возврата
    if (o && pathname !== o.path) clearFocusOrigin();
    if (s && pathname !== s.path) clearScrollOrigin();
    const focus = o && pathname === o.path ? o : null;
    const scroll = s && pathname === s.path ? s : null;
    clearFocusOrigin();
    clearScrollOrigin();
    if (!focus && !scroll) return;
    let focused = !focus;
    const tryFocus = () => {
      if (focused || !focus) return true;
      const el = findFocusOrigin(focus);
      if (!el) return false;
      focused = true;
      el.focus({ preventScroll: true });
      return true;
    };
    if (!scroll) {
      // только фокус: ждём элемент, как раньше
      const timer = setInterval(() => { if (tryFocus()) cleanup(); }, 100);
      const limit = setTimeout(() => cleanup(), 4000);
      const cleanup = () => { clearInterval(timer); clearTimeout(limit); window.removeEventListener('pointerdown', cleanup, true); window.removeEventListener('keydown', cleanup, true); };
      window.addEventListener('pointerdown', cleanup, true);
      window.addEventListener('keydown', cleanup, true);
      return cleanup;
    }
    // страница готова, когда данные дорисованы до сохранённой прокрутки (и найден элемент фокуса, если он был)
    return holdScroll(scroll.y, () => (focus ? findFocusOrigin(focus) !== null : true), tryFocus);
  }, [pathname]);
  return null;
}
