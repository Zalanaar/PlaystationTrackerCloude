'use client';

import { forwardRef } from 'react';
import { Icon } from '../icons';
import type { ArchivedProfile } from './api';
import { initialOf, purgeText } from './model';
import { Spinner } from './Spinner';

/** Блок «Архив» (§17.6): отвязанные профили, «Вернуть» и «Удалить сразу». Рендерится только при непустом архиве. */
export const ProfileArchive = forwardRef<HTMLHeadingElement, {
  items: ArchivedProfile[]; nowMs: number; busyId: number | null; disabled: boolean;
  onRestore: (a: ArchivedProfile) => void; onPurge: (a: ArchivedProfile) => void;
}>(function ProfileArchive({ items, nowMs, busyId, disabled, onRestore, onPurge }, headingRef) {
  if (items.length === 0) return null;
  return (
    <section className="ps-parch" aria-labelledby="ps-parch-h">
      <h2 id="ps-parch-h" ref={headingRef} tabIndex={-1} className="ps-h3">Архив</h2>
      <p className="ps-parch__lead">Отвязанные профили хранятся 30 дней, потом удаляются вместе с данными.</p>
      <ul className="ps-parch__list" aria-label="Архив профилей PSN">
        {items.map((a) => {
          const nick = a.onlineId ?? 'Без ника';
          const restoring = busyId === a.id;
          return (
            <li key={a.id} className="ps-panel ps-parch__row" data-aid={a.id}>
              <span className="ps-parch__ini" aria-hidden="true">{initialOf(a.onlineId)}</span>
              <span className="ps-parch__tx">
                <b title={nick}>{nick}</b>
                <small>{purgeText(a.purgeAt, nowMs)}</small>
              </span>
              <span className="ps-parch__acts">
                <button
                  type="button" className="ps-btn ps-btn--ghost ps-btn--sm" aria-label={`Вернуть профиль ${nick}`}
                  disabled={disabled || a.onlineId === null} aria-busy={restoring || undefined} onClick={() => onRestore(a)}
                >
                  {restoring ? <Spinner size={14} /> : <Icon name="undo" size={14} />}{restoring ? 'Возвращаю…' : 'Вернуть'}
                </button>
                <button
                  type="button" className="ps-btn ps-btn--ghost ps-btn--sm ps-btn--danger" aria-label={`Удалить профиль ${nick} насовсем`}
                  disabled={disabled || a.onlineId === null} onClick={() => onPurge(a)}
                >
                  <Icon name="trash" size={14} />Удалить сразу
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
});
