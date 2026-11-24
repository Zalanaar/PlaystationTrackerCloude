'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { currentMonthIndex, type MonthChip } from './monthChips';
import { useChipRow } from '../primitives/useChipRow';
import { attachChipRowScrollGuard, type ChipRowScrollGuard } from '../primitives/chipRowScroll';

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Граница «под капсулой»: низ плавающей полосы + отступ (как scroll-margin-top якорей). */
function limitPx(nav: HTMLElement): number {
  return nav.getBoundingClientRect().bottom + 12;
}

/** Прокрутка к первой карточке месяца и фокус на неё (docs/design-system.md §8.2). */
export function jumpToAnchor(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  el.focus({ preventScroll: true });
}

/** Counter of the current chip: inline color, not theme cascade, so contrast e2e sees opaque accent in every theme including Night (no data-theme). */
export const CURRENT_CHIP_COUNT_STYLE = {
  color: 'var(--accent-ink)',
  backgroundColor: 'var(--accent)',
  opacity: 1,
  transition: 'none',
} as const;

/**
 * Полоса чипов месяцев раскрытого года Хроники. Sticky под шапкой (CSS), текущий месяц `aria-current="true"`
 * по положению первых карточек месяцев (scroll + rAF), чип прокручивается в видимую часть полосы.
 */
export function MonthChips({ year, chips, onPick }: { year: number; chips: MonthChip[]; onPick?: (c: MonthChip) => void }) {
  const nav = useRef<HTMLElement>(null);
  const fade = useChipRow<HTMLElement>(false); // П9: тень у края; к текущему месяцу докручивает своя логика
  const guard = useRef<ChipRowScrollGuard | null>(null);
  const [cur, setCur] = useState<string>(chips[0]?.key ?? '');
  const setStrip = useCallback((el: HTMLElement | null) => {
    nav.current = el;
    fade(el);
    guard.current?.disconnect();
    guard.current = el ? attachChipRowScrollGuard(el) : null;
  }, [fade]);

  const idsKey = chips.map((c) => c.anchorId).join('|');

  const update = useCallback(() => {
    const el = nav.current;
    if (!el) return;
    const tops = chips.map((c) => document.getElementById(c.anchorId)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY);
    const i = currentMonthIndex(tops, limitPx(el));
    if (i >= 0) setCur(chips[i].key);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- chips меняются вместе с idsKey
  }, [idsKey]);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; update(); });
    };
    const t = setTimeout(update, 0);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      clearTimeout(t);
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [update]);

  // активный чип в видимой части полосы: один scrollTo и только если нет жеста/инерции
  useEffect(() => {
    const strip = nav.current;
    const g = guard.current;
    const chip = strip?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!strip || !chip || !g) return;
    const sr = strip.getBoundingClientRect();
    const cr = chip.getBoundingClientRect();
    let to: number | null = null;
    if (cr.left < sr.left) to = Math.max(0, strip.scrollLeft + (cr.left - sr.left) - 8);
    else if (cr.right > sr.right) to = strip.scrollLeft + (cr.right - sr.right) + 8;
    if (to !== null) g.scrollToIfQuiet(to, reduced() ? 'auto' : 'smooth');
  }, [cur]);

  return (
    <nav className="ps-mchips ps-jumpcap" aria-label={`Месяцы ${year}`}>
      <div ref={setStrip} className="ps-jumpcap__in ps-chiprow">
      {chips.map((c) => (
        <button
          key={c.key} type="button" className="ps-chip ps-mchip" aria-current={cur === c.key ? 'true' : undefined} aria-label={`${c.label} ${c.count} — ${c.aria}`}
          onClick={() => { setCur(c.key); onPick?.(c); jumpToAnchor(c.anchorId); }}
        >
          {c.label}{' '}<small className="num" style={cur === c.key ? CURRENT_CHIP_COUNT_STYLE : undefined}>{c.count}</small>
        </button>
      ))}
      </div>
    </nav>
  );
}

/** Скелет полосы: 6 чипов 56 x --mchip-h. */
export function MonthChipsSkeleton() {
  return (
    <div className="ps-mchips ps-mchips--sk" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => <span key={i} className="ps-skeleton ps-mchip-sk" />)}
    </div>
  );
}
