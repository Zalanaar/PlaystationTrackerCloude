'use client';

import { forwardRef, useId, useState } from 'react';
import { Icon } from '../icons';
import type { DislikeItem } from './api';
import { hiddenForText, returnsInText } from './model';

function Mini({ name, url }: { name: string; url: string | null }) {
  const [bad, setBad] = useState(false);
  /* eslint-disable @next/next/no-img-element -- внешние обложки PSN */
  return url && !bad
    ? <img className="ps-rec-hid__cover" src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} />
    : <span className="ps-rec-hid__cover ps-rec-hid__cover--empty" aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>;
  /* eslint-enable @next/next/no-img-element */
}

/** Сворачиваемый блок «Скрытые на сейчас · N» (§18.9). Закрыт по умолчанию; при 0 игр не рендерится снаружи. */
export const HiddenBlock = forwardRef<HTMLButtonElement, {
  items: readonly DislikeItem[]; ttlDays: number; now: number; open: boolean; busy: ReadonlySet<number>;
  onToggle: () => void; onRestore: (id: number, name: string) => void;
}>(function HiddenBlock({ items, ttlDays, now, open, busy, onToggle, onRestore }, ref) {
  const bodyId = useId();
  return (
    <section className="ps-rec-hid" aria-label="Скрытые на сейчас" id="rec-hidden">
      <button ref={ref} type="button" className="ps-rec-hid__btn" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <Icon name="chevron-down" size={14} className="ps-rec__chev" />
        <span className="ps-rec-hid__t">Скрытые на сейчас · {items.length}</span>
        <small className="ps-rec-hid__ttl">{hiddenForText(ttlDays)}</small>
      </button>
      <div className="ps-rec__whybody" id={bodyId} data-open={open || undefined}>
        <div className="ps-rec__whyin">
          <ul className="ps-rec-hid__list">
            {items.map((it) => (
              <li key={it.game.id} className="ps-rec-hid__row">
                <Mini name={it.game.name} url={it.game.imageUrl} />
                <span className="ps-rec-hid__name" title={it.game.name}>{it.game.name}</span>
                <small className="ps-rec-hid__back">{returnsInText(it.expiresAt, now)}</small>
                <button
                  type="button" className="ps-btn ps-btn--ghost ps-btn--sm ps-rec-hid__ret" disabled={busy.has(it.game.id)}
                  aria-label={`Вернуть: ${it.game.name}`} onClick={() => onRestore(it.game.id, it.game.name)}
                >
                  {busy.has(it.game.id) ? <span className="ps-rec__spin" aria-hidden="true" /> : <Icon name="undo" size={14} />}
                  Вернуть
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
});
