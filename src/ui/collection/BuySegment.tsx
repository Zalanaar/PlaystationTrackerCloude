'use client';

import { useRef, type KeyboardEvent } from 'react';
import { Icon } from '../icons';

/**
 * Сегмент «Не купил / Купил» (design-system §19b.2): radiogroup, roving tabindex, стрелки переключают.
 * bought = false — «Не купил» (по умолчанию), true — «Купил».
 */
export function BuySegment({
  title, bought, onChange, disabled, compact, testPrefix = 'add',
}: { title: string; bought: boolean; onChange: (bought: boolean) => void; disabled?: boolean; compact?: boolean; testPrefix?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  function key(e: KeyboardEvent) {
    const k = e.key;
    if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowUp' && k !== 'ArrowDown') return;
    e.preventDefault();
    const next = !bought;
    onChange(next);
    // фокус идёт вместе с выбором (roving tabindex)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-buy="${next ? 'yes' : 'no'}"]`)?.focus());
  }
  const opt = (yes: boolean, label: string) => {
    const on = bought === yes;
    return (
      <button
        type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} disabled={disabled} data-buy={yes ? 'yes' : 'no'}
        data-testid={`${testPrefix}-buy-${yes ? 'yes' : 'no'}`} onClick={() => onChange(yes)}
      >
        {on && <Icon name="check" size={12} className="ps-add-buy__ck" />}{label}
      </button>
    );
  };
  return (
    <div
      ref={ref} className={`ps-seg ps-add-buy${compact ? ' ps-add-buy--compact' : ''}`} role="radiogroup" aria-label={`Покупка: ${title}`}
      data-testid={`${testPrefix}-buy`} onKeyDown={key}
    >
      {opt(false, 'Не купил')}
      {opt(true, 'Купил')}
    </div>
  );
}
