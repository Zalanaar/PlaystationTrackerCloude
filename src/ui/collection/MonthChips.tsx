'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { currentMonthIndex, type MonthChip } from './monthChips';

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Граница «под полосой»: шапка + полоса + отступ (как scroll-margin-top якорей). */
function limitPx(nav: HTMLElement): number {
  const header = document.querySelector<HTMLElement>('.ps-header')?.offsetHeight ?? 56;
  return header + nav.offsetHeight + 12;
}

/** Прокрутка к первой карточке месяца и фокус на неё (docs/design-system.md §8.2). */
export function jumpToAnchor(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  el.focus({ preventScroll: true });
}

/**
 * Полоса чипов месяцев раскрытого года Хроники. Sticky под шапкой (CSS), текущий месяц `aria-current="true"`
 * по положению первых карточек месяцев (scroll + rAF), чип прокручивается в видимую часть полосы.
 */
export function MonthChips({ year, chips, onPick }: { year: number; chips: MonthChip[]; onPick?: (c: MonthChip) => void }) {
  const nav = useRef<HTMLElement>(null);
  const [cur, setCur] = useState<string>(chips[0]?.key ?? '');
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

  // активный чип остаётся в видимой части полосы (прокручиваем саму полосу, не страницу)
  useEffect(() => {
    const strip = nav.current;
    const chip = strip?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!strip || !chip) return;
    const left = chip.offsetLeft;
    const right = left + chip.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollTo({ left: left - 8, behavior: reduced() ? 'auto' : 'smooth' });
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: right - strip.clientWidth + 8, behavior: reduced() ? 'auto' : 'smooth' });
  }, [cur]);

  return (
    <nav ref={nav} className="ps-mchips" aria-label={`Месяцы ${year}`}>
      {chips.map((c) => (
        <button
          key={c.key} type="button" className="ps-chip ps-mchip" aria-current={cur === c.key ? 'true' : undefined} aria-label={c.aria}
          onClick={() => { setCur(c.key); onPick?.(c); jumpToAnchor(c.anchorId); }}
        >
          {c.label}<small className="num">{c.count}</small>
        </button>
      ))}
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
