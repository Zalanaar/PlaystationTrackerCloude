// Кнопки мобильной шапки «Поиск» и «+» (D-P2). Шапка не знает о странице: она шлёт событие, страница его слушает.
// Набор кнопок задаётся путём (статично, одинаково на сервере и клиенте), поэтому шапка не меняется после гидрации (CLS 0).
import { useEffect, useRef } from 'react';

export type HeaderAction = 'search' | 'add';
export const HEADER_ACTION_EVENT = 'ps:header-action';

/** Какие кнопки показывает мобильная шапка на пути. */
export function headerActionsFor(pathname: string): { search: boolean; add: boolean } {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return { search: p === '/' || p === '/backlog', add: p === '/backlog' };
}

export function emitHeaderAction(action: HeaderAction): void {
  window.dispatchEvent(new CustomEvent<HeaderAction>(HEADER_ACTION_EVENT, { detail: action }));
}

/** Страница подписывается на кнопку шапки. Обработчик берётся последний, без переподписки. */
export function useHeaderAction(action: HeaderAction, handler: () => void): void {
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<HeaderAction>).detail === action) ref.current(); };
    window.addEventListener(HEADER_ACTION_EVENT, on);
    return () => window.removeEventListener(HEADER_ACTION_EVENT, on);
  }, [action]);
}
