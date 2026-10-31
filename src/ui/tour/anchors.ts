'use client';

import { useEffect, type RefObject } from 'react';

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

/**
 * Якоря первой видимой карточки Коллекции (design-system §10.7): `game-card` на article, `card-status` на её фигуре статуса.
 * Расставляются прямо в DOM (карточка рендерится во многих блоках), не меняют вёрстку; в режиме выбора снимаются.
 */
export function useTourCardAnchors(root: RefObject<HTMLElement | null>, selectMode: boolean): void {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      el.querySelectorAll('[data-tour="game-card"], [data-tour="card-status"]').forEach((n) => n.removeAttribute('data-tour'));
      if (selectMode) return;
      const first = Array.from(el.querySelectorAll<HTMLElement>('article.ps-card')).find(visible);
      if (!first) return;
      first.setAttribute('data-tour', 'game-card');
      first.querySelector('.ps-card__status')?.setAttribute('data-tour', 'card-status');
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true, subtree: true });
    return () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [root, selectMode]);
}
