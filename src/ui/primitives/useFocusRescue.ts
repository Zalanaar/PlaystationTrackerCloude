'use client';

import { useEffect, type RefObject } from 'react';

/** Кнопки-открыватели карточек и строк списков (Коллекция, Бэклог). */
const HITS = 'button.ps-card__hit, button.ps-row__hit, button.ps-blrow__hit';
/** Запасной элемент, если карточек не осталось: заголовок вида с tabindex=-1. */
const FALLBACK = '#coll-title, #h-bl-main';

/**
 * Игра исчезла из списка (смена статуса, скрытие, пакетное действие) вместе с сфокусированным элементом: браузер роняет фокус на body.
 * Помним, на какой по счёту карточке стоял фокус; когда элемент удалён и фокус ушёл на body, ставим его на карточку с тем же номером
 * (то есть на следующую), а если карточек нет, на заголовок вида. Фокус не трогаем, если он ушёл в окно или другой элемент.
 * Фокус внутри диалога не запоминаем; страницу при спасении фокуса не прокручиваем.
 */
export function useFocusRescue(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let last: { el: Element; index: number } | null = null;

    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof Element)) return;
      // окно игры и другие диалоги внутри вида: их закрытие не «исчезновение карточки» (Safari на iPhone: фокус на body, вид прыгал к заголовку)
      if (el.closest('[role="dialog"]')) { last = null; return; }
      const card = el.closest('article, li, tr');
      const hit = card?.querySelector(HITS) ?? (el.matches(HITS) ? el : null);
      const hits = Array.from(root.querySelectorAll(HITS));
      last = { el, index: hit ? Math.max(0, hits.indexOf(hit)) : -1 };
    };
    const onFocusInOutside = (e: FocusEvent) => {
      if (e.target instanceof Node && !root.contains(e.target)) last = null;
    };

    let raf = 0;
    const check = () => {
      raf = 0;
      if (!last || last.el.isConnected) return;
      const active = document.activeElement;
      const { index } = last;
      last = null;
      if (active && active !== document.body) return;
      const hits = Array.from(root.querySelectorAll<HTMLElement>(HITS));
      const target = index >= 0 && hits.length > 0 ? hits[Math.min(index, hits.length - 1)] : root.querySelector<HTMLElement>(FALLBACK);
      // без прокрутки: спасение фокуса не должно сдвигать страницу
      target?.focus({ preventScroll: true });
    };
    const mo = new MutationObserver(() => { if (!raf && last && !last.el.isConnected) raf = requestAnimationFrame(check); });
    mo.observe(root, { childList: true, subtree: true });

    root.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusin', onFocusInOutside);
    return () => {
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
      root.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusin', onFocusInOutside);
    };
  }, [rootRef]);
}
