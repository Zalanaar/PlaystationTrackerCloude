'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';

/** Модальное окно: на десктопе по центру, на мобильном bottom sheet. Портал в body (шапка с blur ломает fixed). */
export function Sheet({
  open, onClose, title, children, wide, className, role = 'dialog', describedBy, initialFocus, busy,
}: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; className?: string;
  /** alertdialog для подтверждений (Фаза 43) */
  role?: 'dialog' | 'alertdialog';
  describedBy?: string;
  /** CSS-селектор элемента внутри, на который падает фокус при открытии (по умолчанию сам диалог) */
  initialFocus?: string;
  /** Идёт запись: Esc, подложка и крестик не закрывают окно */
  busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const target = initialFocus ? ref.current?.querySelector<HTMLElement>(initialFocus) : null;
    (target ?? ref.current)?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- селектор фокуса нужен только в момент открытия
  }, [open]);

  // Фокус мог упасть на body: сфокусированная кнопка внутри исчезла (например, «Повторить» сменилась сообщением),
  // а onKeyDown панели ловит только события изнутри. Тогда Esc ловим на документе, но только верхней модалкой.
  const closeRef = useRef({ onClose, busy });
  useEffect(() => { closeRef.current = { onClose, busy }; });
  useEffect(() => {
    if (!open) return;
    const onDocKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const a = document.activeElement;
      if (a && a !== document.body) return;
      const modals = document.querySelectorAll('[aria-modal="true"]');
      if (modals[modals.length - 1] !== ref.current) return;
      e.preventDefault();
      if (!closeRef.current.busy) closeRef.current.onClose();
    };
    document.addEventListener('keydown', onDocKey);
    return () => document.removeEventListener('keydown', onDocKey);
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!busy) onClose();
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
      <div className="ps-sheet-backdrop" onClick={busy ? undefined : onClose} aria-hidden="true" />
      <div ref={ref} role={role} aria-modal="true" aria-labelledby={titleId} aria-describedby={describedBy} aria-busy={busy || undefined} tabIndex={-1} className={className ? `ps-sheet ${className}` : 'ps-sheet'} data-wide={wide ? 'true' : undefined}>
        <div className="ps-sheet__handle" aria-hidden="true" />
        <div className="ps-sheet__head">
          <h2 id={titleId} className="ps-h3">{title}</h2>
          <button type="button" className="ps-iconbtn" onClick={onClose} aria-label="Закрыть" disabled={busy}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="ps-sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
