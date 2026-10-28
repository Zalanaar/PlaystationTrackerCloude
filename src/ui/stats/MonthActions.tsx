'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';
import { useIsMobile } from '../primitives/hooks';
import { Sheet } from '../primitives/Sheet';
import { type ExcludePlan } from './monthExclusion';

type Step = 'menu' | 'confirm';

/**
 * Кнопка «⋯» на карточке «Игр месяца» (спека 9.1 п.4): меню «Убрать из этого месяца» / «Вернуть в месяц»
 * и, если у игры есть измеренные часы, подтверждение. Десктоп: панель у кнопки, мобильный: bottom sheet.
 * Само действие выполняет родитель (`onExclude` / `onRestore`).
 */
export function MonthActions({
  label, excluded, busy, plan, onExclude, onRestore,
}: {
  label: string; excluded: boolean; busy: boolean; plan: ExcludePlan; onExclude: () => void; onRestore: () => void;
}) {
  const mobile = useIsMobile();
  const [step, setStep] = useState<Step | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback((refocus: boolean) => {
    setStep(null);
    if (refocus) btn.current?.focus();
  }, []);

  function pickExclude() {
    if (plan.kind === 'silent') {
      close(false);
      onExclude();
    } else setStep('confirm');
  }
  function pickRestore() {
    close(false);
    onRestore();
  }

  const body = step && (
    <Body
      step={step} excluded={excluded} plan={plan} sheet={mobile}
      onExclude={pickExclude} onConfirm={() => { close(false); onExclude(); }} onRestore={pickRestore} onCancel={() => close(true)}
    />
  );

  return (
    <>
      <button
        ref={btn} type="button" className="ps-mm" aria-label={label} aria-haspopup="menu" aria-expanded={step !== null} disabled={busy}
        onClick={() => setStep((s) => (s ? null : 'menu'))}
      >
        <Icon name="more" size={16} />
      </button>
      {step && (mobile
        ? <Sheet open onClose={() => close(true)} title={step === 'menu' ? 'Действия' : 'Подтверждение'}>{body}</Sheet>
        : <Floating anchor={btn} layoutKey={step} onClose={close} width={step === 'menu' ? 248 : 320}>{body}</Floating>)}
    </>
  );
}

function Body({
  step, excluded, plan, sheet, onExclude, onConfirm, onRestore, onCancel,
}: {
  step: Step; excluded: boolean; plan: ExcludePlan; sheet: boolean;
  onExclude: () => void; onConfirm: () => void; onRestore: () => void; onCancel: () => void;
}) {
  const titleId = useId();
  if (step === 'confirm' && plan.kind === 'confirm') {
    return (
      <div className="ps-mm__confirm" role="group" aria-labelledby={titleId}>
        <h4 id={titleId}>{plan.title}</h4>
        {plan.lines.map((l) => <p key={l}>{l}</p>)}
        <div className="ps-mm__btns">
          <button type="button" className="ps-btn ps-btn--primary" onClick={onConfirm}>Убрать из списка</button>
          <button type="button" className="ps-btn ps-btn--ghost" onClick={onCancel}>Отмена</button>
        </div>
      </div>
    );
  }
  return (
    <div role="menu" className={sheet ? 'ps-list' : undefined}>
      {excluded ? (
        <button type="button" role="menuitem" className="ps-menu-item ps-menu-item--tall" onClick={onRestore}>
          <Icon name="calendar-plus" size={16} /><span className="ps-menu-item__label">Вернуть в месяц</span>
        </button>
      ) : (
        <>
          <button type="button" role="menuitem" className="ps-menu-item ps-menu-item--tall" onClick={onExclude}>
            <Icon name="calendar-x" size={16} /><span className="ps-menu-item__label">Убрать из этого месяца</span>
          </button>
          <p className="ps-mm__hint">Игра останется в коллекции и в других месяцах</p>
        </>
      )}
    </div>
  );
}

const GAP = 6;
const MARGIN = 8;

/** Панель у кнопки (портал в body: обложка обрезает вложенное). Flip вверх при нехватке места, Esc, клик и фокус снаружи закрывают. */
function Floating({
  anchor, layoutKey, onClose, width, children,
}: {
  anchor: RefObject<HTMLButtonElement | null>; layoutKey: string; onClose: (refocus: boolean) => void; width: number; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const p = ref.current;
      if (!a || !p) return;
      if (a.bottom < 0 || a.top > window.innerHeight) {
        onClose(false);
        return;
      }
      const w = p.offsetWidth;
      const h = p.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const below = window.innerHeight - a.bottom - GAP - MARGIN;
      const above = a.top - GAP - MARGIN;
      const flip = h > below && above > below;
      setPos({ left: Math.max(MARGIN, Math.min(a.right - w, vw - w - MARGIN)), top: flip ? a.top - GAP - h : a.bottom + GAP });
    };
    place();
    window.addEventListener('scroll', place, true);
    return () => window.removeEventListener('scroll', place, true);
  }, [anchor, onClose, layoutKey]);

  const placed = pos !== null;
  useEffect(() => {
    if (placed) ref.current?.querySelector<HTMLElement>('button')?.focus();
  }, [placed, layoutKey]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target;
      if (t instanceof Node && !ref.current?.contains(t) && !anchor.current?.contains(t)) onClose(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose(true);
      }
    };
    const away = () => onClose(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', away);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref} className="ps-mm__panel" style={{ width, left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? undefined : 'hidden' }}
      onBlur={(e) => {
        const next = e.relatedTarget;
        if (next instanceof Node && !ref.current?.contains(next) && !anchor.current?.contains(next)) onClose(false);
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
