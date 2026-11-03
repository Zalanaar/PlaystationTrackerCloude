'use client';

import { useEffect, useState, type RefObject } from 'react';
import { Icon } from '../icons';

/** Порог появления: примерно один экран прокрутки вниз. */
export const BACK_TO_TOP_SCREENS = 1;

/**
 * Кнопка «Наверх» (пакет 4): только мобильный и PWA (на десктопе скрыта стилями), position: fixed — без CLS.
 * Без `scroller` следит за окном, со `scroller` — за внутренней прокруткой (окно игры).
 * Плавная прокрутка, при prefers-reduced-motion — мгновенная. Не показывается поверх sheet, тура и тостов (стили `.ps-totop`).
 */
export function BackToTop({ scroller, inDialog = false }: { scroller?: RefObject<HTMLElement | null>; inDialog?: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const el = scroller?.current ?? null;
    const target: HTMLElement | Window = el ?? window;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const y = el ? el.scrollTop : window.scrollY;
      const h = el ? el.clientHeight : window.innerHeight;
      setShow(mq.matches && y > h * BACK_TO_TOP_SCREENS);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    target.addEventListener('scroll', onScroll, { passive: true });
    mq.addEventListener('change', onScroll);
    onScroll();
    return () => {
      target.removeEventListener('scroll', onScroll);
      mq.removeEventListener('change', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scroller]);

  if (!show) return null;
  const up = (keyboard: boolean) => {
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const el = scroller?.current ?? null;
    if (el) el.scrollTo({ top: 0, behavior });
    else window.scrollTo({ top: 0, behavior });
    // с клавиатуры фокус уходит в начало содержимого, иначе после исчезновения кнопки он падал бы на body
    if (keyboard) (el?.closest<HTMLElement>('[role="dialog"]') ?? document.getElementById('main'))?.focus({ preventScroll: true });
  };
  return (
    <button
      type="button" className="ps-totop" data-in-dialog={inDialog || undefined} aria-label="Наверх" title="Наверх"
      onClick={(e) => up(e.detail === 0)}
    >
      <Icon name="arrow-up" size={20} />
    </button>
  );
}
