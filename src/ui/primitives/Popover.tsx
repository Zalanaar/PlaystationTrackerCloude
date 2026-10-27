'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

type TriggerProps = {
  onClick: () => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
};

/** Выпадающее меню: Esc, клик снаружи, стрелки по пунктам `[role^=menuitem]`. */
export function Popover({
  trigger, children, align = 'start', className,
}: {
  trigger: (p: TriggerProps) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    const first = ref.current?.querySelector<HTMLElement>('[role^="menuitem"][aria-checked="true"], [role^="menuitem"]');
    first?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      ref.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
  }

  return (
    <div ref={ref} className={`ps-pop ${className ?? ''}`} onKeyDown={onKey}>
      {trigger({ onClick: () => setOpen((v) => !v), 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? id : undefined })}
      {open && (
        <div id={id} role="menu" className="ps-pop__panel" data-align={align}>
          {children(close)}
        </div>
      )}
    </div>
  );
}
