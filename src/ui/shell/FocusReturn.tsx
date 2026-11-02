'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { clearFocusOrigin, findFocusOrigin, peekFocusOrigin } from '../collection/useGameLink';

/**
 * Возврат фокуса на элемент-источник после закрытия окна игры, открытого с другой страницы (R-1).
 * Ждёт, пока страница загрузит данные (до 4 с); любое действие пользователя отменяет возврат.
 * Прокрутка возвращается к сохранённой при открытии окна, фокус ставится без прокрутки.
 */
export function FocusReturn() {
  const pathname = usePathname();
  useEffect(() => {
    const o = peekFocusOrigin();
    if (!o) return;
    if (pathname === '/') return; // окно открыто на Коллекции, ждём возврата
    if (pathname !== o.path) { clearFocusOrigin(); return; }
    let done = false;
    const stop = () => { done = true; clearFocusOrigin(); clearInterval(timer); clearTimeout(limit); window.removeEventListener('pointerdown', stop, true); window.removeEventListener('keydown', stop, true); };
    const timer = setInterval(() => {
      if (done) return;
      const el = findFocusOrigin(o);
      if (!el) return;
      // прежняя прокрутка, когда страница уже достаточно высокая; фокус без прокрутки к элементу
      if (o.y !== undefined) {
        if (document.documentElement.scrollHeight - window.innerHeight < o.y - 1) return;
        window.scrollTo(0, o.y);
      }
      stop();
      el.focus({ preventScroll: true });
    }, 100);
    const limit = setTimeout(stop, 4000);
    window.addEventListener('pointerdown', stop, true);
    window.addEventListener('keydown', stop, true);
    return () => { if (!done) { clearInterval(timer); clearTimeout(limit); window.removeEventListener('pointerdown', stop, true); window.removeEventListener('keydown', stop, true); } };
  }, [pathname]);
  return null;
}
