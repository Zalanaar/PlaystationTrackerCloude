'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { currentSection, STATS_SECTIONS } from './sections';

/** Время для блокировки подсветки (только в обработчиках, не в рендере). */
const nowMs = () => Date.now();
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * D-P5: липкая полоса чипов разделов под шапкой. Полоса рендерится сразу (фиксированная высота, без сдвига страницы);
 * чипы — только для разделов, которые есть в DOM (меняется лишь ширина ряда). Тап прокручивает к разделу, при прокрутке
 * подсвечивается текущий. Без backdrop-filter: единичная полоса с непрозрачным фоном.
 */
export function SectionChips({ rootRef }: { rootRef: RefObject<HTMLElement | null> }) {
  const [present, setPresent] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const lock = useRef(0);

  const find = useCallback((id: string): HTMLElement | null => {
    const s = STATS_SECTIONS.find((x) => x.id === id);
    return s ? (rootRef.current?.querySelector<HTMLElement>(s.selector) ?? null) : null;
  }, [rootRef]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    const scan = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const ids = STATS_SECTIONS.filter((s) => root.querySelector(s.selector)).map((s) => s.id);
        setPresent((prev) => (prev.join() === ids.join() ? prev : ids));
      });
    };
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(root, { childList: true, subtree: true });
    return () => { mo.disconnect(); cancelAnimationFrame(raf); };
  }, [rootRef]);

  useEffect(() => {
    if (present.length === 0) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (nowMs() < lock.current) return;
      const line = (bar.current?.getBoundingClientRect().bottom ?? 0) + 16;
      const tops = present.map((id) => ({ id, top: find(id)?.getBoundingClientRect().top ?? Infinity }));
      const doc = document.documentElement;
      const atBottom = window.scrollY > 0 && window.innerHeight + window.scrollY >= doc.scrollHeight - 2;
      setActive(currentSection(tops, line, atBottom));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [present, find]);

  // текущий чип виден в ряду (горизонтальная прокрутка только самой полосы, страница не двигается)
  useEffect(() => {
    const b = bar.current;
    const chip = active ? b?.querySelector<HTMLElement>(`[data-sec="${active}"]`) : null;
    if (!b || !chip) return;
    const l = chip.offsetLeft - b.offsetLeft;
    if (l < b.scrollLeft || l + chip.offsetWidth > b.scrollLeft + b.clientWidth) b.scrollTo({ left: Math.max(0, l - 16), behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [active]);

  const go = (id: string) => {
    const el = find(id);
    if (!el) return;
    setActive(id);
    lock.current = nowMs() + 700; // плавная прокрутка не перещёлкивает подсветку по пути
    el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <nav className="ps-st-secs" aria-label="Разделы статистики" data-testid="stats-sections">
      <div className="ps-st-secs__in" ref={bar}>
        {STATS_SECTIONS.filter((s) => present.includes(s.id)).map((s) => (
          <button key={s.id} type="button" className="ps-st-secs__chip" data-sec={s.id} aria-current={active === s.id ? 'true' : undefined} onClick={() => go(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
