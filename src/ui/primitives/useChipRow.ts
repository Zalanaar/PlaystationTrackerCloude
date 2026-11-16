'use client';
// П9: ряд чипов с горизонтальной прокруткой. Мягкая тень (маска) у края, за которым есть ещё чипы, и прокрутка к выбранному чипу.
// Без состояния React: атрибуты data-edge-l / data-edge-r ставятся прямо на элемент (без перерисовок при прокрутке).
import { useCallback, useRef } from 'react';

const SELECTED = '[aria-pressed="true"], [aria-current="true"], [aria-current="page"]';

/** Есть ли ещё контент слева / справа (допуск 2 px на дробные пиксели). */
export function scrollEdges(scrollLeft: number, clientWidth: number, scrollWidth: number): { l: boolean; r: boolean } {
  return { l: scrollLeft > 2, r: scrollLeft + clientWidth < scrollWidth - 2 };
}

/** Куда прокрутить, чтобы чип [left, left+width] был виден целиком с запасом pad; null — уже виден. */
export function scrollToShow(chipLeft: number, chipWidth: number, scrollLeft: number, clientWidth: number, pad = 16): number | null {
  if (chipLeft < scrollLeft + pad) return Math.max(0, chipLeft - pad);
  if (chipLeft + chipWidth > scrollLeft + clientWidth - pad) return chipLeft + chipWidth - clientWidth + pad;
  return null;
}

/** ref-колбэк для контейнера ряда. follow: следить за выбранным чипом (aria-pressed / aria-current) и докручивать к нему. */
export function useChipRow<T extends HTMLElement>(follow = true): (el: T | null) => void {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    const edges = () => {
      const e = scrollEdges(el.scrollLeft, el.clientWidth, el.scrollWidth);
      el.toggleAttribute('data-edge-l', e.l);
      el.toggleAttribute('data-edge-r', e.r);
    };
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const show = (smooth: boolean, target?: HTMLElement) => {
      const chip = target ?? el.querySelector<HTMLElement>(SELECTED);
      if (!chip || el.scrollWidth <= el.clientWidth) return;
      const left = chip.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
      const to = scrollToShow(left, chip.offsetWidth, el.scrollLeft, el.clientWidth);
      if (to !== null) el.scrollTo({ left: to, behavior: smooth && !reduced() ? 'smooth' : 'auto' });
    };
    edges();
    if (follow) show(false);
    el.addEventListener('scroll', edges, { passive: true });
    const ro = new ResizeObserver(() => edges());
    ro.observe(el);
    const mo = new MutationObserver((list) => {
      edges();
      if (!follow) return;
      // только что выбранный чип (в ряду может быть два выбранных: период и «Только редкие»)
      const on = list.find((m) => m.type === 'attributes' && m.target instanceof HTMLElement && m.target.matches(SELECTED));
      if (on) show(true, on.target as HTMLElement);
    });
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-current'] });
    cleanup.current = () => { el.removeEventListener('scroll', edges); ro.disconnect(); mo.disconnect(); };
  }, [follow]);
}
