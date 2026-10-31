'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';
import { useIsMobile } from '../primitives/hooks';
import {
  announce, anchorCandidates, isFirst, isLast, keyboardHeight, NAV_TIMEOUT_MS, needsNavigation, pageMarkerFor, placePopover, READY_WAIT_MS,
  scrollDelta, spotBox, textForAnchor, variantFor, type Box,
} from './model';
import { ROUTE_LABEL, TOUR_STEPS, TOUR_TOTAL, type TourRoute } from './steps';

type View = { kind: 'loading' } | { kind: 'center'; note: boolean } | { kind: 'spot'; foundId: string };
type Geo = { box: Box; radius: number; gap: number; gutter: number };

export type TourOverlayProps = {
  index: number;
  dir: 'fwd' | 'back';
  navigate: (route: TourRoute) => void;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  /** true = закрыть и открыть Разбор */
  onFinish: (openTriage: boolean) => void;
};

const sameView = (a: View, b: View) => a.kind === b.kind && (a as { note?: boolean }).note === (b as { note?: boolean }).note && (a as { foundId?: string }).foundId === (b as { foundId?: string }).foundId;
const sameBox = (a: Box, b: Box) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const px = (name: string, fallback: number) => {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
};

function findVisible(id: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`);
  for (const el of Array.from(all)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

/** Элемент (или предок) зафиксирован на экране: прокручивать к нему не нужно */
function isPinned(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
    const pos = getComputedStyle(n).position;
    if (pos === 'fixed' || pos === 'sticky') return true;
  }
  return false;
}

const SCROLL_KEYS = new Set([' ', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);

export function TourOverlay(props: TourOverlayProps) {
  const { index, dir, navigate, onNext, onPrev, onSkip, onFinish } = props;
  const step = TOUR_STEPS[index];
  const last = isLast(index);
  const first = isFirst(index);
  const mobile = useIsMobile();
  const pathname = usePathname();
  const uid = useId();
  const titleId = `${uid}-t`;
  const textId = `${uid}-d`;

  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const [view, setViewState] = useState<View>({ kind: 'loading' });
  const [geo, setGeo] = useState<Geo | null>(null);
  const [popSize, setPopSize] = useState<{ w: number; h: number } | null>(null);
  const [kb, setKb] = useState(0);
  const [sr, setSr] = useState('');
  const [scrolling, setScrolling] = useState(false);

  const setView = useCallback((v: View) => setViewState((p) => (sameView(p, v) ? p : v)), []);
  const cb = useRef({ onNext, onPrev, onSkip, last, first });
  useEffect(() => { cb.current = { onNext, onPrev, onSkip, last, first }; });

  // ---------- выбор вида шага: ожидание страницы и якоря ----------
  useLayoutEffect(() => {
    const st = TOUR_STEPS[index];
    const need = needsNavigation(st.route, pathname);
    if (need) navigate(st.route);
    const cands = anchorCandidates(st, mobile);
    const marker = pageMarkerFor(st.route);
    let expired = false;
    let cancelled = false;
    let raf = 0;

    const evaluate = () => {
      raf = 0;
      if (cancelled) return;
      if (need) { setView(expired ? { kind: 'center', note: variantFor(st, mobile).note !== null } : { kind: 'loading' }); return; }
      if (cands.length === 0) { elRef.current = null; setView({ kind: 'center', note: false }); return; }
      for (const id of cands) {
        const el = findVisible(id);
        if (el) { elRef.current = el; setView({ kind: 'spot', foundId: id }); return; }
      }
      elRef.current = null;
      const ready = marker === null || !!document.querySelector(`[data-tour-page="${marker}"][data-tour-ready="true"]`);
      if (ready || expired) setView({ kind: 'center', note: variantFor(st, mobile).note !== null });
      else setView({ kind: 'loading' });
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(evaluate); };

    evaluate();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-tour', 'data-tour-ready'] });
    const expire = () => { expired = true; evaluate(); };
    const t1 = need ? setTimeout(expire, NAV_TIMEOUT_MS) : setTimeout(expire, READY_WAIT_MS);
    return () => { cancelled = true; mo.disconnect(); clearTimeout(t1); if (raf) cancelAnimationFrame(raf); };
  }, [index, mobile, pathname, navigate, setView]);

  // ---------- геометрия прожектора ----------
  const measure = useCallback(() => {
    const el = elRef.current;
    if (!el || !el.isConnected) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const vp = { w: document.documentElement.clientWidth, h: window.innerHeight };
    const pad = px('--tour-pad', 8);
    const ringW = px('--tour-ring-w', 2);
    const box = spotBox({ x: r.left, y: r.top, w: r.width, h: r.height }, pad, px('--tap-min', 44), vp, ringW);
    const own = parseFloat(getComputedStyle(el).borderTopLeftRadius);
    const radius = Math.min(28, (Number.isFinite(own) ? own : 8) + pad);
    const next: Geo = { box, radius, gap: px('--tour-gap', 12), gutter: px('--gutter', 24) };
    setGeo((p) => (p && sameBox(p.box, box) && p.radius === radius && p.gap === next.gap && p.gutter === next.gutter ? p : next));
  }, []);

  useLayoutEffect(() => {
    if (view.kind === 'spot') measure();
  }, [view, measure]);

  // прокрутка к элементу и пересчёт при прокрутке / ресайзе
  useEffect(() => {
    if (view.kind !== 'spot') return;
    const el = elRef.current;
    if (!el) return;
    let raf = 0;
    let tScroll: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure(); }); };
    const onScroll = () => {
      setScrolling(true);
      clearTimeout(tScroll);
      tScroll = setTimeout(() => setScrolling(false), 150);
      schedule();
    };
    // ensure visible
    const ensure = requestAnimationFrame(() => {
      if (!el.isConnected || isPinned(el)) return;
      const r = el.getBoundingClientRect();
      const pad = px('--tour-pad', 8);
      const headerBottom = document.querySelector('header.ps-header')?.getBoundingClientRect().bottom ?? 0;
      const popTop = popRef.current?.getBoundingClientRect().top ?? window.innerHeight;
      const area = { top: Math.max(headerBottom, 0) + pad + 2, bottom: (mobile ? popTop : window.innerHeight) - pad - 2 };
      const d = scrollDelta({ top: r.top - pad, bottom: r.bottom + pad }, area);
      if (Math.abs(d) > 1) window.scrollBy({ top: d, behavior: reducedMotion() ? 'auto' : 'smooth' });
    });
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', schedule);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(ensure);
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(tScroll);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', schedule);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      ro.disconnect();
    };
  }, [view, index, mobile, measure]);

  // ---------- размер поповера ----------
  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const upd = () => setPopSize((p) => (p && p.w === pop.offsetWidth && p.h === pop.offsetHeight ? p : { w: pop.offsetWidth, h: pop.offsetHeight }));
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(pop);
    return () => ro.disconnect();
  }, [index, view.kind]);

  // ---------- экранная клавиатура (мобильный) ----------
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const upd = () => setKb(keyboardHeight(window.innerHeight, vv));
    upd();
    vv.addEventListener('resize', upd);
    vv.addEventListener('scroll', upd);
    return () => { vv.removeEventListener('resize', upd); vv.removeEventListener('scroll', upd); };
  }, []);

  // ---------- inert, блокировка прокрутки пользователем ----------
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>('header.ps-header, main.ps-main, nav.ps-tabbar, .ps-toasts')).filter((n) => !n.inert);
    targets.forEach((n) => { n.inert = true; });
    document.documentElement.classList.add('ps-tour-lock');
    (document.activeElement as HTMLElement | null)?.blur?.();
    return () => {
      targets.forEach((n) => { n.inert = false; });
      document.documentElement.classList.remove('ps-tour-lock');
    };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const stop = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return; // текст листа на мобильном прокручивается
      if (e.cancelable) e.preventDefault();
    };
    root.addEventListener('wheel', stop, { passive: false });
    root.addEventListener('touchmove', stop, { passive: false });
    return () => { root.removeEventListener('wheel', stop); root.removeEventListener('touchmove', stop); };
  }, []);

  // ---------- клавиатура: capture на window, чтобы горячие клавиши приложения не срабатывали ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const pop = popRef.current;
      if (e.key === 'Tab') {
        if (!pop) return;
        const f = Array.from(pop.querySelectorAll<HTMLElement>('button')).filter((b) => b.getClientRects().length > 0 && !b.hasAttribute('disabled'));
        if (f.length === 0) { e.preventDefault(); return; }
        const i = f.indexOf(document.activeElement as HTMLElement);
        if (i < 0) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
        else if (e.shiftKey && i === 0) { e.preventDefault(); f[f.length - 1].focus(); }
        return;
      }
      e.stopPropagation();
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const onButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON';
      if (e.key === 'Escape') { e.preventDefault(); cb.current.onSkip(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); if (!cb.current.last) cb.current.onNext(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); if (!cb.current.first) cb.current.onPrev(); return; }
      if (SCROLL_KEYS.has(e.key) && !(onButton && e.key === ' ')) e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // фокус не уходит из диалога
  useEffect(() => {
    const onIn = (e: FocusEvent) => {
      if (popRef.current && e.target instanceof Node && !popRef.current.contains(e.target)) popRef.current.focus();
    };
    document.addEventListener('focusin', onIn);
    return () => document.removeEventListener('focusin', onIn);
  }, []);

  // фокус: при открытии на поповер, при смене шага на «Далее» (вперёд) или «Назад» (назад)
  const firstRun = useRef(true);
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (firstRun.current) {
      firstRun.current = false;
      popRef.current?.focus({ preventScroll: true });
      return;
    }
    const target = dir === 'back' && backRef.current ? backRef.current : nextRef.current;
    (target ?? popRef.current)?.focus({ preventScroll: true });
  }, [index, dir]);

  // объявление шага (при старте не объявляется: читается диалог)
  const announcedFirst = useRef(true);
  useEffect(() => {
    if (announcedFirst.current) { announcedFirst.current = false; return; }
    const st = TOUR_STEPS[index];
    setSr(announce(index, st.title, variantFor(st, mobile).text));
  }, [index, mobile]);

  // ---------- вывод ----------
  const mode = view.kind === 'spot' && geo ? 'spot' : view.kind === 'loading' ? 'loading' : 'center';
  const foundId = view.kind === 'spot' ? view.foundId : null;
  const text = mode === 'loading' ? '' : textForAnchor(step, mobile, foundId);
  const note = view.kind === 'center' && view.note ? variantFor(step, mobile).note : null;
  const loadingText = step.route === '*' ? 'Открываем раздел…' : `Открываем раздел «${ROUTE_LABEL[step.route]}»…`;

  let popStyle: CSSProperties | undefined;
  let side: string = step.place;
  if (mode === 'spot' && geo && !mobile) {
    if (popSize) {
      const p = placePopover(geo.box, popSize, { w: document.documentElement.clientWidth, h: window.innerHeight }, step.place, geo.gap, geo.gutter);
      popStyle = { left: p.left, top: p.top };
      side = p.side;
    } else popStyle = { visibility: 'hidden' };
  }
  const rootStyle = { '--tour-kb': `${kb}px` } as CSSProperties;
  const spotStyle: CSSProperties | undefined = geo
    ? { transform: `translate(${geo.box.x}px, ${geo.box.y}px)`, width: geo.box.w, height: geo.box.h, borderRadius: geo.radius }
    : undefined;

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={rootRef} className="ps-tour" data-mode={mode} data-kb={kb > 0 || undefined} data-scrolling={scrolling || undefined} style={rootStyle}
      onMouseDown={(e) => { if (!popRef.current?.contains(e.target as Node)) e.preventDefault(); }}
    >
      <div className="ps-tour__dim" aria-hidden="true" />
      {mode === 'spot' && <div className="ps-tour__spot" aria-hidden="true" style={spotStyle} />}
      <section
        ref={popRef} className="ps-tour__pop" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={textId} tabIndex={-1}
        data-place={side} data-last={last || undefined} style={popStyle}
      >
        <div className="ps-tour__bar" aria-hidden="true"><i style={{ width: `${((index + 1) / TOUR_TOTAL) * 100}%` }} /></div>
        <header className="ps-tour__head">
          <p className="ps-tour__count num" data-testid="tour-count">{index + 1} из {TOUR_TOTAL}</p>
          {!last && <button type="button" className="ps-link ps-tour__skip" aria-label="Пропустить тур" onClick={onSkip}>Пропустить</button>}
        </header>
        <div className="ps-tour__body" key={index}>
          {mode === 'center' && <Icon name={last ? 'check-circle' : 'info'} size={24} className={last ? 'ps-tour__ico ps-tour__ico--ok' : 'ps-tour__ico'} />}
          <h2 id={titleId} className={mode === 'loading' ? 'ps-tour__title ps-sr' : 'ps-tour__title'}>{step.title}</h2>
          {mode === 'loading' ? (
            <p id={textId} className="ps-tour__text ps-tour__wait" data-testid="tour-loading"><Icon name="loader" size={20} className="ps-tour__spin" />{loadingText}</p>
          ) : (
            <p id={textId} className="ps-tour__text">{text}</p>
          )}
          {note && <p className="ps-tour__note" data-testid="tour-note">{note}</p>}
        </div>
        <footer className="ps-tour__foot">
          {last ? (
            <>
              <button ref={backRef} type="button" className="ps-btn ps-btn--ghost" onClick={onPrev}>Назад</button>
              <button type="button" className="ps-btn ps-btn--ghost" onClick={() => onFinish(true)}>Открыть Разбор</button>
              <button ref={nextRef} type="button" className="ps-btn ps-btn--primary" onClick={() => onFinish(false)}>Готово</button>
            </>
          ) : (
            <>
              {first ? <span className="ps-tour__ph" aria-hidden="true" /> : <button ref={backRef} type="button" className="ps-btn ps-btn--ghost" onClick={onPrev}>Назад</button>}
              <button
                ref={nextRef} type="button" className="ps-btn ps-btn--primary" aria-disabled={mode === 'loading' || undefined}
                onClick={() => { if (mode !== 'loading') onNext(); }}
              >
                Далее
              </button>
            </>
          )}
        </footer>
      </section>
      <div className="ps-sr" role="status" aria-live="polite">{sr}</div>
    </div>,
    document.body,
  );
}
