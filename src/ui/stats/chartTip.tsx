'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

export type TipTarget = { key: string | number; el: HTMLElement };

/**
 * Подсказка столбца: hover/focus показывают, клик/тап закрепляет (закрытие: повторный тап, тап вне, Escape).
 * Состояние общее для графика; `panelRef` нужен, чтобы позиционировать подсказку вне прокручиваемой области.
 */
export function useChartTip() {
  const [active, setActive] = useState<TipTarget | null>(null);
  const [pinned, setPinned] = useState(false);
  const [groupEl, attachGroup] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      if (groupEl && e.target instanceof Node && groupEl.contains(e.target)) return;
      setPinned(false);
      setActive(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [pinned, groupEl]);
  const close = useCallback(() => { setPinned(false); setActive(null); }, []);
  const itemProps = (key: string | number) => ({
    onMouseEnter: (e: MouseEvent<HTMLElement>) => { if (!pinned) setActive({ key, el: e.currentTarget }); },
    onFocus: (e: FocusEvent<HTMLElement>) => { if (!pinned) setActive({ key, el: e.currentTarget }); },
    onBlur: () => { if (!pinned) setActive((a) => (a && a.key === key ? null : a)); },
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (pinned && active?.key === key) close();
      else { setPinned(true); setActive({ key, el: e.currentTarget }); }
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => { if (e.key === 'Escape') close(); },
  });
  const groupProps = { onMouseLeave: () => { if (!pinned) setActive(null); } };
  return { active, attachGroup, groupProps, itemProps, close };
}

/** Подсказка над столбцом в координатах панели (position: relative); прижимается к краям вьюпорта. */
export function ChartTip({ target, panel, children }: { target: TipTarget | null; panel: HTMLElement | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !panel || !target) return;
    const a = target.el.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    el.style.left = `${a.left + a.width / 2 - p.left}px`;
    el.style.top = `${a.top - p.top - 4}px`;
    el.style.translate = '-50% -100%';
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const m = 8;
    const dx = r.right > vw - m ? vw - m - r.right : r.left < m ? m - r.left : 0;
    if (dx) el.style.translate = `calc(-50% + ${dx}px) -100%`;
  });
  if (!target) return null;
  return <div ref={ref} className="ps-st-tip ps-st-tip--float ps-num" role="tooltip">{children}</div>;
}

/** Один раз в видимой области (анимация появления столбцов). Уже показанный график (по id) не анимируется повторно. */
const shown = new Set<string>();
export function useInViewOnce(id: string) {
  const [el, ref] = useState<HTMLElement | null>(null);
  const [instant] = useState(() => shown.has(id));
  const [seen, setSeen] = useState(instant);
  useEffect(() => {
    if (seen || !el) return;
    if (typeof IntersectionObserver === 'undefined') { const t = setTimeout(() => setSeen(true), 0); return () => clearTimeout(t); }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { shown.add(id); setSeen(true); io.disconnect(); }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [id, seen, el]);
  return { attach: ref, seen, instant };
}
