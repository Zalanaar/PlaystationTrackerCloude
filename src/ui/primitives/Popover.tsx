'use client';

import { useCallback, useEffect, useLayoutEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

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
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);

  /** Переворот вверх, когда снизу не хватает места (нижняя навигация, край окна). Меряем offsetHeight: на transform анимации он не реагирует. */
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const wrap = ref.current;
      const panel = panelRef.current;
      if (!wrap || !panel) return;
      delete panel.dataset.flip;
      const r = wrap.getBoundingClientRect();
      const h = panel.offsetHeight + 6;
      const tab = document.querySelector('.ps-tabbar');
      const tabTop = tab && getComputedStyle(tab).display !== 'none' ? tab.getBoundingClientRect().top : window.innerHeight;
      const bottomLimit = Math.min(window.innerHeight, tabTop) - 8;
      const below = bottomLimit - r.bottom;
      const above = r.top - 8;
      if (h > below && above > below) panel.dataset.flip = 'up';
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

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
    if (!open) return;
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
        <div ref={panelRef} id={id} role="menu" className="ps-pop__panel" data-align={align}>
          {children(close)}
        </div>
      )}
    </div>
  );
}
