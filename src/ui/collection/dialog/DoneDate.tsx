'use client';

import { useState } from 'react';
import type { GameItem } from '@/server/collection/types';
import { formatDate } from '../../format';
import { Icon } from '../../icons';
import { doneLabel } from '../details';
import { completionInfo, dateInputToIso, isoToDateInput } from '../filters';

/**
 * D-P4: дата прохождения или броска рядом с чипом статуса шапки окна; правка кнопкой ✎ 44×44 (было: ссылка «Изменить» 68×20 в «Статус и даты»).
 * Форма раскрывается строкой ниже чипов. `startEditing` = окно открыто из меню «Изменить дату».
 */
export function DoneDate({ game, now, startEditing, onDate }: { game: GameItem; now: number; startEditing: boolean; onDate: (g: GameItem, kind: 'completed' | 'dropped', iso: string) => void }) {
  const done = completionInfo(game);
  const [editing, setEditing] = useState(startEditing && !!done);
  const [value, setValue] = useState(isoToDateInput(done?.iso));
  const [err, setErr] = useState<string | null>(null);
  if (!done) return null;
  const today = isoToDateInput(new Date(now).toISOString());
  const label = doneLabel(done.kind);
  const text = formatDate(done.iso);

  function save() {
    if (!done) return;
    const iso = dateInputToIso(value, now);
    if (!iso) {
      setErr('Укажи дату целиком.');
      return;
    }
    onDate(game, done.kind, iso);
    setEditing(false);
  }

  return (
    <>
      <span className="ps-gd__done" data-kind={done.kind} data-testid="done-date">
        <span className="ps-gd__donet"><span className="ps-sr">{label}: </span><span className="num" title={label}>{text}</span></span>
        {!editing && (
          <button
            type="button" className="ps-gd__doneedit" aria-label={`${text}, изменить дату`} title={`Изменить: ${label.toLowerCase()}`}
            onClick={() => { setValue(isoToDateInput(done.iso)); setErr(null); setEditing(true); }}
          >
            <Icon name="pencil" size={16} />
          </button>
        )}
      </span>
      {editing && (
        <form className="ps-inline-form ps-gd__doneform" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <label className="ps-gd__donelbl">
            <span>{label}</span>
            <input type="date" className="ps-input" value={value} max={today} aria-label="Дата завершения" onChange={(e) => { setValue(e.target.value); setErr(null); }} />
          </label>
          <button type="submit" aria-label="Сохранить дату завершения" className="ps-btn ps-btn--primary">Сохранить</button>
          <button type="button" className="ps-btn" onClick={() => setEditing(false)}>Отмена</button>
          {err && <span role="alert" className="ps-field-error">{err}</span>}
        </form>
      )}
    </>
  );
}
