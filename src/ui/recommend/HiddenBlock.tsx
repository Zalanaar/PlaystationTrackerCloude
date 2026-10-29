'use client';

import { forwardRef, useId, useState } from 'react';
import { Icon } from '../icons';
import { hiddenForText, returnsInText } from './model';

/** Строка блока: общий вид для игр библиотеки и внешних игр (RAWG). */
export type HiddenRow = { key: string; name: string; imageUrl: string | null; expiresAt: string };

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
  items: readonly HiddenRow[]; ttlDays: number; now: number; open: boolean; busy: ReadonlySet<string>;
  onToggle: () => void; onRestore: (key: string, name: string) => void; id?: string;
}>(function HiddenBlock({ items, ttlDays, now, open, busy, onToggle, onRestore, id = 'rec-hidden' }, ref) {
  const bodyId = useId();
  return (
    <section className="ps-rec-hid" aria-label="Скрытые на сейчас" id={id}>
      <button ref={ref} type="button" className="ps-rec-hid__btn" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <Icon name="chevron-down" size={14} className="ps-rec__chev" />
        <span className="ps-rec-hid__t">Скрытые на сейчас · {items.length}</span>
        <small className="ps-rec-hid__ttl">{hiddenForText(ttlDays)}</small>
      </button>
      <div className="ps-rec__whybody" id={bodyId} data-open={open || undefined}>
        <div className="ps-rec__whyin">
          <ul className="ps-rec-hid__list">
            {items.map((it) => (
              <li key={it.key} className="ps-rec-hid__row">
                <Mini name={it.name} url={it.imageUrl} />
                <span className="ps-rec-hid__name" title={it.name}>{it.name}</span>
                <small className="ps-rec-hid__back">{returnsInText(it.expiresAt, now)}</small>
                <button
                  type="button" className="ps-btn ps-btn--ghost ps-btn--sm ps-rec-hid__ret" disabled={busy.has(it.key)}
                  aria-label={`Вернуть: ${it.name}`} onClick={() => onRestore(it.key, it.name)}
                >
                  {busy.has(it.key) ? <span className="ps-rec__spin" aria-hidden="true" /> : <Icon name="undo" size={14} />}
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
