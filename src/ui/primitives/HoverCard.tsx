'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useIsMobile, useMediaQuery } from './hooks';
import { HOVER_CLOSE_MS, HOVER_OPEN_MS, placePanel } from './placement';
import { Sheet } from './Sheet';

type TriggerProps = {
  onClick: () => void;
  'aria-haspopup': 'dialog';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
};

/**
 * Карточка по наведению (design-system §4.17.1). Не меню: `role="dialog"`, стрелки не нужны, Tab ходит по содержимому.
 * Десктоп: hover с задержкой 150 мс, focus-visible сразу; закрытие: уход курсора (100 мс, курсор может перейти в панель),
 * blur, Esc (фокус на триггер). Клик по триггеру открывает сразу (без задержки).
 * Мобильный и устройства без hover: bottom sheet по тапу.
 */
export function HoverCard({
  trigger, label, sheetTitle, children, disabled, className,
}: {
  trigger: (p: TriggerProps) => ReactNode;
  /** aria-label панели: «Игры жанра Экшен» */
  label: string;
  /** Заголовок bottom sheet на мобильном */
  sheetTitle: string;
  /** `closeToTrigger`: закрыть и вернуть фокус на триггер (перед открытием окна из панели, чтобы окно вернуло фокус на строку) */
  children: (ctx: { close: () => void; closeToTrigger: () => void; sheet: boolean }) => ReactNode;
  /** Нечего показывать: триггер без поповера */
  disabled?: boolean;
  className?: string;
}) {
  const mobile = useIsMobile();
  const noHover = useMediaQuery('(hover: none)');
  const sheet = mobile || noHover;
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const { open, setOpen, openIn, closeIn, clear, close, closeToTrigger, isQuiet, setQuiet } = useHoverIntent(wrap);

  // Позиция: вниз или вверх, сдвиг от краёв окна
  useLayoutEffect(() => {
    const p = panel.current;
    const w = wrap.current;
    if (!open || !p || !w || sheet) return;
    p.dataset.flip = '';
    p.style.translate = '';
    const t = w.getBoundingClientRect();
    const r = p.getBoundingClientRect();
    const pos = placePanel(t, { width: r.width, height: r.height }, { width: document.documentElement.clientWidth, height: window.innerHeight });
    if (pos.flip) p.dataset.flip = 'up';
    if (pos.shiftX) p.style.translate = `${pos.shiftX}px 0`;
  }, [open, sheet]);

  if (disabled) return <div className={`ps-hc ${className ?? ''}`}>{trigger({ onClick: () => {}, 'aria-haspopup': 'dialog', 'aria-expanded': false, 'aria-controls': undefined })}</div>;

  const props: TriggerProps = {
    onClick: () => { clear(); setQuiet(false); setOpen(true); }, // клик по уже открытой (hover) панели не закрывает её: закрытие Esc, blur, уход курсора
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    'aria-controls': open && !sheet ? id : undefined,
  };

  if (sheet) {
    return (
      <div className={`ps-hc ${className ?? ''}`}>
        {trigger(props)}
        <Sheet open={open} onClose={close} title={sheetTitle}>{children({ close, closeToTrigger: close, sheet: true })}</Sheet>
      </div>
    );
  }

  return (
    <div
      ref={wrap} className={`ps-hc ${className ?? ''}`}
      onMouseEnter={() => { setQuiet(false); if (!open) openIn(HOVER_OPEN_MS); else clear(); }}
      onMouseLeave={() => closeIn(HOVER_CLOSE_MS)}
      onFocus={(e) => {
        const el = e.target as HTMLElement;
        if (panel.current?.contains(el)) return;
        if (!isQuiet() && el.matches(':focus-visible')) { clear(); setOpen(true); }
      }}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (!next || !wrap.current?.contains(next)) closeIn(0);
      }}
      onKeyDown={(e) => {
        setQuiet(false);
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          closeToTrigger();
        }
      }}
    >
      {trigger(props)}
      {open && (
        <div ref={panel} id={id} role="dialog" aria-label={label} className="ps-hc__panel" onMouseDown={(e) => e.preventDefault()}>
          {children({ close, closeToTrigger, sheet: false })}
        </div>
      )}
    </div>
  );
}

/** Таймеры наведения и флаг «тихого» фокуса. Вынесено в хук: refs не должны читаться в render. */
function useHoverIntent(wrap: React.RefObject<HTMLDivElement | null>) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quiet = useRef(false);
  const clear = useCallback(() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } }, []);
  const openIn = useCallback((ms: number) => { clear(); timer.current = setTimeout(() => setOpen(true), ms); }, [clear]);
  const closeIn = useCallback((ms: number) => { clear(); timer.current = setTimeout(() => setOpen(false), ms); }, [clear]);
  useEffect(() => clear, [clear]);
  const close = useCallback(() => { clear(); setOpen(false); }, [clear]);
  const closeToTrigger = useCallback(() => {
    // программный фокус (в том числе возврат из окна игры по Esc) не должен снова открывать панель:
    // «тихий» режим держится до следующего действия пользователя на карточке (наведение, клавиша, клик)
    quiet.current = true;
    wrap.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
    clear();
    setOpen(false);
  }, [clear, wrap]);
  const isQuiet = useCallback(() => quiet.current, []);
  const setQuiet = useCallback((v: boolean) => { quiet.current = v; }, []);
  return { open, setOpen, openIn, closeIn, clear, close, closeToTrigger, isQuiet, setQuiet };
}
