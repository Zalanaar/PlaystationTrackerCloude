'use client';

import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { tintStyle } from '../tint';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Оболочка: role=dialog, блокировка прокрутки, focus trap, Esc, возврат фокуса. */
export function Frame({ onClose, tint, children }: { onClose: () => void; tint?: string | null; children: (titleId: string) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Layout-эффекты: окно открывается в переходе роутера, и обычный эффект мог выполниться уже после отрисовки.
  // Тогда Esc сразу после появления окна уходил на кнопку под ним и терялся.
  useLayoutEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, []);

  // Клавиши на уровне документа: фокус мог потеряться (нажатая кнопка исчезла из DOM), Esc и Tab всё равно должны работать.
  // События из вложенных порталов (sheet статуса) сюда не относятся: они сами обрабатывают Esc и Tab.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useLayoutEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const root = ref.current;
      if (!root || e.defaultPrevented) return;
      const t = e.target;
      const inside = t instanceof Node && (root.contains(t) || t === document.body || t === document.documentElement);
      if (!inside) return;
      if (e.key === 'Escape') {
        if ((t as HTMLElement).tagName === 'SELECT') return;
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const f = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      const active = document.activeElement;
      const lost = !(active instanceof Node) || !root.contains(active) || active === root;
      if (e.shiftKey && (lost || active === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (lost || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div ref={ref} className="ps-gd" style={tintStyle(tint)} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <div className="ps-gd__scroll">{children(titleId)}</div>
    </div>
  );
}
