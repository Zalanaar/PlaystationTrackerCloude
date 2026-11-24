'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { WrappedResponse } from '@/server/wrapped/types';
import { Icon } from '../icons';
import { useMediaQuery } from '../primitives/hooks';
import {
  slideTitle, classifyGesture, isAutoAdvance, keyAction, parseDurationMs, resolveSlides, segmentFill, stepIndex, tickTimer, HOLD_MS, TIMER_START, type Dir, type TimerState,
} from './model';
import { slideColor } from './look';
import { Backdrop } from './StoryParts';
import { SlideView } from './WrappedSlides';

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function WrappedStory({ data, onClose }: { data: WrappedResponse; onClose: () => void }) {
  const slides = useMemo(() => resolveSlides(data), [data]);
  const count = slides.length;
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  // П8.5: пауза кнопкой (или P); держится и при ручном листании, пока не нажмут «Продолжить»
  const [paused, setPaused] = useState(false);
  const [mounted, setMounted] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const fillRef = useRef<HTMLSpanElement | null>(null);
  const gesture = useRef<{ x: number; y: number; t: number; timer: ReturnType<typeof setTimeout> | null } | null>(null);

  const slide = slides[index];
  const isAll = data.scope === 'all';
  const auto = isAutoAdvance({ reducedMotion: reduced, index, count, slide });
  const autoRef = useRef(auto);
  useEffect(() => { autoRef.current = auto; }, [auto]);
  useEffect(() => { pausedRef.current = held || paused; }, [held, paused]);

  const go = useCallback((dir: Dir) => setIndex((i) => stepIndex(i, dir, count)), [count]);

  // портал после монтирования (SSR не рисует историю)
  useEffect(() => { const t = setTimeout(() => setMounted(true), 0); return () => clearTimeout(t); }, []);

  // фокус: запомнить, перевести в диалог, вернуть; блокировка прокрутки страницы
  useEffect(() => {
    if (!mounted) return;
    const prev = document.activeElement as HTMLElement | null;
    root.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [mounted]);

  // таймер сегмента: rAF, чистый шаг tickTimer; пауза по удержанию и скрытой вкладке
  useEffect(() => {
    if (!mounted) return;
    const duration = parseDurationMs(getComputedStyle(document.documentElement).getPropertyValue('--dur-slide'));
    let state: TimerState = TIMER_START;
    let last = performance.now();
    let raf = 0;
    fillRef.current?.style.setProperty('--p', autoRef.current ? '0' : '1');
    const frame = (now: number) => {
      const dt = now - last;
      last = now;
      const paused = pausedRef.current || document.hidden;
      const r = tickTimer(state, dt, { duration, paused, auto: autoRef.current });
      state = r.state;
      fillRef.current?.style.setProperty('--p', String(autoRef.current ? state.elapsed / duration : 1));
      if (r.done) { go('next'); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [mounted, index, go]);

  // клавиатура и ловушка фокуса
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const items = Array.from(root.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
        if (!items.length) { e.preventDefault(); return; }
        const first = items[0];
        const lastEl = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === root.current || !root.current?.contains(active))) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && (active === lastEl || !root.current?.contains(active))) { e.preventDefault(); first.focus(); }
        return;
      }
      const onButton = (e.target as HTMLElement | null)?.closest?.('button, a') != null;
      const a = keyAction({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, onButton });
      if (!a) return;
      e.preventDefault();
      if (a === 'close') onClose();
      else if (a === 'pause') { if (autoRef.current) setPaused((p) => !p); }
      else go(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, go, onClose]);

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* не критично */ }
    const timer = setTimeout(() => setHeld(true), HOLD_MS);
    gesture.current = { x: e.clientX, y: e.clientY, t: performance.now(), timer };
  };
  const finish = (e: RPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (g.timer) clearTimeout(g.timer);
    setHeld(false);
    if (cancelled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const r = classifyGesture({
      dx: e.clientX - g.x, dy: e.clientY - g.y, durationMs: performance.now() - g.t, x: e.clientX - rect.left, width: rect.width,
    });
    if (r.kind === 'tap' || r.kind === 'swipe') go(r.dir);
  };

  if (!mounted) return null;

  const rm = reduced;
  return createPortal(
    <div className="ps-story" data-reduced={rm || undefined}>
      <div
        ref={root} className="ps-story__stage" role="dialog" aria-modal="true" aria-label={isAll ? 'За всё время' : `Итоги ${data.year}`} tabIndex={-1}
        data-slide={slide} data-index={index} data-paused={held || (paused && auto) || undefined} data-auto={auto || undefined}
        style={{ '--slide-base': slideColor(slide) } as CSSProperties}
        onContextMenu={(e) => e.preventDefault()} onPointerDown={onDown} onPointerUp={(e) => finish(e, false)} onPointerCancel={(e) => finish(e, true)}
      >
        <Backdrop data={data} id={slide} />
        <div className="ps-story__top">
          <div className="ps-story__bars" aria-hidden="true">
            {slides.map((s, i) => (
              <span key={`${s}-${i}`} className="ps-story__seg" data-state={i < index ? 'done' : i === index ? 'cur' : 'todo'}>
                <span ref={i === index ? fillRef : undefined} className="ps-story__fill" style={{ '--p': segmentFill(i, index, 0, auto) } as CSSProperties} />
              </span>
            ))}
          </div>
          <div className="ps-story__head">
            <span className="ps-story__brand">PS TRACKER · {isAll ? 'ВСЁ ВРЕМЯ' : data.year}</span>
            <span className="ps-story__ctl">
              {auto && (
                <button
                  type="button" className="ps-story__close ps-story__pause" data-testid="story-pause" aria-pressed={paused}
                  aria-label={paused ? 'Продолжить' : 'Пауза'} title={paused ? 'Продолжить (P)' : 'Пауза (P)'} onClick={() => setPaused((p) => !p)}
                >
                  <Icon name={paused ? 'play' : 'pause'} size={18} />
                </button>
              )}
              <button type="button" className="ps-story__close" aria-label="Закрыть итоги" onClick={onClose}><Icon name="x" size={20} /></button>
            </span>
          </div>
        </div>
        <div className="ps-story__body" key={index}>
          <SlideView id={slide} data={data} rm={rm} index={index} count={count} onClose={onClose} onRestart={() => setIndex(0)} />
        </div>
        <p className="ps-sr" role="status" aria-live="polite">{`Слайд ${index + 1} из ${count}. ${slideTitle(slide, isAll ? 'all' : 'year')}`}</p>
      </div>
    </div>,
    document.body,
  );
}
