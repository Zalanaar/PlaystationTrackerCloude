'use client';

import { useId, useState } from 'react';
import type { GameItem } from '@/server/collection/types';
import '../backlog.css';
import { Icon } from '../icons';
import { ApiError, errorText, patchDuration } from './api';
import { durationText, hltbStatusText, hoursInputValue, MAX_HOURS, MIN_HOURS, parseHoursInput, sourceLabel } from './backlog';

const RANGE = `от ${hoursInputValue(MIN_HOURS)} до ${MAX_HOURS}`;

/** Блок «Длительность» в окне игры: эффективные часы с источником, статус HLTB, ручной ввод и сброс (контракт 16.5). */
export function DurationEditor({ game, onChanged }: { game: GameItem; onChanged: (g: GameItem) => void }) {
  const d = game.duration;
  const inputId = useId();
  const errId = useId();
  const [text, setText] = useState(hoursInputValue(d?.overrideHours));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  if (!d) return null;
  const src = sourceLabel(d.source);
  const manual = d.overrideHours !== null;

  async function send(hours: number | null) {
    setBusy(true);
    setErr(null);
    setSaved(null);
    try {
      const r = await patchDuration(game.id, hours);
      setText(hoursInputValue(r.game.duration?.overrideHours));
      setSaved(hours === null ? 'Ручное значение сброшено' : 'Сохранено');
      onChanged(r.game);
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 400 ? `Сервер не принял значение. Допустимо ${RANGE} ч.` : `Не удалось сохранить. ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const n = parseHoursInput(text);
    if (n === null) {
      setSaved(null);
      setErr(`Введи число часов ${RANGE}.`);
      return;
    }
    void send(n);
  }

  return (
    <section className="ps-gd__sec ps-gd__duration" aria-labelledby="gd-dur">
      <h3 id="gd-dur">Длительность прохождения</h3>
      <dl>
        <div className="ps-gd__kv">
          <dt>Сейчас</dt>
          <dd data-testid="duration-now">
            <b className="num">{durationText(d)}</b>
            {src && <span className="ps-bl-src" data-source={d.source}>{src}</span>}
          </dd>
        </div>
        <div className="ps-gd__kv ps-gd__kv--long">
          <dt>HowLongToBeat</dt>
          <dd data-testid="duration-hltb">
            {hltbStatusText(d.hltb)}
            {d.hltb.status === 'found' && d.hltb.mainHours !== null && <span className="num">{` · сюжет ${durationText({ hours: d.hltb.mainHours })}`}</span>}
          </dd>
        </div>
      </dl>
      <form className="ps-inline-form ps-bl-form" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <label htmlFor={inputId} className="ps-gd__lbl">Своя оценка, часов</label>
        <input
          id={inputId} className="ps-input ps-bl-hours num" inputMode="decimal" autoComplete="off" value={text} placeholder="например, 25"
          aria-invalid={err ? true : undefined} aria-describedby={err ? errId : undefined} disabled={busy}
          onChange={(e) => { setText(e.target.value); setErr(null); setSaved(null); }}
        />
        <button type="submit" className="ps-btn ps-btn--primary" disabled={busy}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
        {manual && (
          <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} onClick={() => void send(null)}>
            <Icon name="undo" size={16} />Сбросить ручное значение
          </button>
        )}
      </form>
      {err && <p id={errId} role="alert" className="ps-field-error">{err}</p>}
      {saved && !err && <p role="status" className="ps-detail__hint">{saved}</p>}
    </section>
  );
}
