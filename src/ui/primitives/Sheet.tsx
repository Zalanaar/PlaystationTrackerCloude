'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';

/** Модальное окно: на десктопе по центру, на мобильном bottom sheet. Портал в body (шапка с blur ломает fixed). */
export function Sheet({
  open, onClose, title, children, wide, className,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const f = Array.from(
      ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="ps-sheet-wrap" onKeyDown={onKey}>
      <div className="ps-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={className ? `ps-sheet ${className}` : 'ps-sheet'} data-wide={wide ? 'true' : undefined}>
        <div className="ps-sheet__handle" aria-hidden="true" />
        <div className="ps-sheet__head">
          <h2 id={titleId} className="ps-h3">{title}</h2>
          <button type="button" className="ps-iconbtn" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="ps-sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
