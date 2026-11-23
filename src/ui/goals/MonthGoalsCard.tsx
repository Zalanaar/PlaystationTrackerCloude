'use client';

// Цели месяца на главной: прогресс по играм / часам / трофеям; пустое состояние предлагает задать цель.
import { useCallback, useEffect, useId, useState } from 'react';
import { STATUSES_CHANGED_EVENT } from '../backup/StatusMenu';
import { Icon } from '../icons';
import { Sheet } from '../primitives/Sheet';
import { useEverTrue } from '../useEverTrue';
import type { MonthGoalsView } from '@/shared/month-goals';
import { fetchMonthGoals, saveMonthGoalsApi } from './api';
import { barPercent, fieldHint, GOAL_LABEL, GOAL_LIMITS, GOAL_ORDER, monthTitle, parseField, progressLine, type GoalFields, type GoalKey } from './model';

const emptyFields = (): Record<GoalKey, string> => ({ games: '', hours: '', trophies: '' });

function fieldsFrom(g: GoalFields): Record<GoalKey, string> {
  const o = emptyFields();
  for (const k of GOAL_ORDER) o[k] = g[k] == null ? '' : String(g[k]);
  return o;
}

export function MonthGoalsCard() {
  const hid = useId();
  const [data, setData] = useState<MonthGoalsView | null>(null);
  const [gone, setGone] = useState(false);
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Record<GoalKey, string>>(emptyFields);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorEver = useEverTrue(open);

  const load = useCallback((signal?: AbortSignal) => {
    return fetchMonthGoals(signal).then(
      (r) => { if (!signal?.aborted) { setData(r); setGone(false); } },
      () => { if (!signal?.aborted) setGone(true); },
    );
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  useEffect(() => {
    const on = () => { void load(); };
    window.addEventListener(STATUSES_CHANGED_EVENT, on);
    return () => window.removeEventListener(STATUSES_CHANGED_EVENT, on);
  }, [load]);

  function openEditor() {
    if (!data) return;
    setFields(fieldsFrom(data.goals));
    setError(null);
    setOpen(true);
  }

  async function save(next: GoalFields) {
    setBusy(true); setError(null);
    try {
      const r = await saveMonthGoalsApi(next);
      setData(r);
      setOpen(false);
    } catch {
      setError('Не удалось сохранить. Попробуй ещё раз.');
    } finally { setBusy(false); }
  }

  function submit() {
    const value: GoalFields = { games: null, hours: null, trophies: null };
    for (const k of GOAL_ORDER) {
      const p = parseField(fields[k], k);
      if (!p.ok) { setError(fieldHint(k)); return; }
      value[k] = p.value;
    }
    if (!value.games && !value.hours && !value.trophies) { setError('Укажи хотя бы одну цель — или убери все.'); return; }
    void save(value);
  }

  if (gone || !data) return null;

  const title = `Цели на ${monthTitle(data.monthNum)}`;
  const rows = GOAL_ORDER.filter((k) => data.goals[k] != null);

  return (
    <>
      <section className="ps-mgoals" aria-labelledby={hid} data-testid="month-goals">
        <div className="ps-mgoals__head">
          <h2 id={hid} className="ps-mgoals__t">{title}</h2>
          {data.hasGoals && (
            <button type="button" className="ps-iconbtn ps-mgoals__edit" aria-label="Изменить цели" onClick={openEditor}>
              <Icon name="pencil" size={16} />
            </button>
          )}
        </div>
        {data.hasGoals ? (
          <ul className="ps-mgoals__rows">
            {rows.map((k) => {
              const goal = data.goals[k] as number;
              const current = data.progress[k];
              const pct = barPercent(current, goal);
              const done = current >= goal;
              return (
                <li key={k} className="ps-mgoals__row" data-done={done || undefined} data-testid={`month-goals-${k}`}>
                  <span className="ps-mgoals__lbl">{GOAL_LABEL[k]}</span>
                  <span className="ps-mgoals__val num">{progressLine(k, current, goal)}</span>
                  <span className="ps-mgoals__bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="ps-mgoals__empty">
            <p className="ps-mgoals__lead">Сколько игр пройти, часов наиграть или трофеев взять — цель задаёшь сам.</p>
            <button type="button" className="ps-btn ps-btn--primary" onClick={openEditor} data-testid="month-goals-set">Задать цель</button>
          </div>
        )}
      </section>
      {editorEver && (
        <Sheet open={open} onClose={() => !busy && setOpen(false)} title={title} busy={busy} initialFocus="input">
          <form className="ps-mgoals-form" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <p className="ps-mgoals-form__lead">Можно заполнить одно поле или несколько. Пустое поле — без этой цели.</p>
            {GOAL_ORDER.map((k) => {
              const parsed = parseField(fields[k], k);
              const invalid = fields[k].trim() !== '' && !parsed.ok;
              const fid = `${hid}-${k}`;
              return (
                <div key={k} className="ps-mgoals-form__row">
                  <label className="ps-mgoals-form__lbl" htmlFor={fid}>{GOAL_LABEL[k]}</label>
                  <input
                    id={fid} className="ps-input" type="number" inputMode="numeric" min={GOAL_LIMITS[k].min} max={GOAL_LIMITS[k].max} step={1}
                    value={fields[k]} disabled={busy} data-testid={`month-goals-input-${k}`}
                    aria-invalid={invalid || undefined} aria-describedby={`${fid}-h`}
                    onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
                  />
                  <p className="ps-mgoals-form__h" id={`${fid}-h`}>{fieldHint(k)}</p>
                </div>
              );
            })}
            {error && <p className="ps-mgoals-form__err" role="alert">{error}</p>}
            <div className="ps-mgoals-form__btns">
              <button type="submit" className="ps-btn ps-btn--primary" disabled={busy} aria-busy={busy || undefined}>Сохранить</button>
              <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} onClick={() => setOpen(false)}>Отмена</button>
              {data.hasGoals && (
                <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} data-testid="month-goals-clear" onClick={() => void save({ games: null, hours: null, trophies: null })}>
                  Убрать цели
                </button>
              )}
            </div>
          </form>
        </Sheet>
      )}
    </>
  );
}
