'use client';

import { useId, useRef, useState } from 'react';
import { ApiError } from '../collection/api';
import { Icon } from '../icons';
import { Popover } from '../primitives/Popover';
import { useToast } from '../primitives/Toast';
import { useIsMobile } from '../primitives/hooks';
import { deleteGoal, putGoal } from './api';
import {
  GOAL_MAX, GOAL_MIN, goalAsOfText, goalBarLabel, goalBarPercent, goalFormHint, goalForecastText, goalMetrics, goalPaceText, goalRangeText, goalRequiredText,
  goalSaveError, goalState, goalTitle, modeDescription, modeLabel, parseGoalCount, type GoalMode, type GoalView,
} from './goal-model';
import { Spinner } from './parts';

const MODES: readonly GoalMode[] = ['complete', 'backlog_to'];

function GoalForm({
  initial, year, busy, error, onCancel, onSave,
}: { initial: GoalView | null; year: number; busy: boolean; error: string | null; onCancel: () => void; onSave: (mode: GoalMode, count: number) => void }) {
  const id = useId();
  const [mode, setMode] = useState<GoalMode>(initial?.mode ?? 'complete');
  const [text, setText] = useState(initial ? String(initial.count) : '');
  const [touched, setTouched] = useState(false);
  const count = parseGoalCount(text, mode);
  const invalid = count === null;
  const showErr = invalid && (touched || text.trim() !== '');
  const dirty = !initial || initial.mode !== mode || initial.count !== count;
  const canSave = !busy && !invalid && dirty;
  const hint = goalFormHint(mode, count, initial && initial.mode === mode ? initial.current : null);

  function bump(delta: number) {
    const cur = parseGoalCount(text, mode) ?? (Number(text) || GOAL_MIN[mode]);
    setText(String(Math.min(GOAL_MAX, Math.max(GOAL_MIN[mode], cur + delta))));
    setTouched(true);
  }
  function submit() {
    setTouched(true);
    if (canSave && count !== null) onSave(mode, count);
  }
  return (
    <form
      className="ps-rm-goalform" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}
      onKeyDown={(e) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onCancel(); } }}
    >
      <div>
        <span className="ps-rm-lbl" id={`${id}-m`}>Тип цели</span>
        <div className="ps-rm-gseg" role="radiogroup" aria-labelledby={`${id}-m`}>
          {MODES.map((m) => (
            <button
              key={m} type="button" role="radio" aria-checked={mode === m} disabled={busy} data-testid={`rm-goal-mode-${m}`}
              tabIndex={mode === m ? 0 : -1}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  const next = MODES[(MODES.indexOf(m) + 1) % MODES.length];
                  setMode(next);
                  (e.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-testid="rm-goal-mode-${next}"]`))?.focus();
                }
              }}
              onClick={() => setMode(m)}
            >{modeLabel(m)}</button>
          ))}
        </div>
        <p className="ps-rm-hint ps-rm-goalform__desc">{modeDescription(mode, year, count ?? initial?.count ?? 12)}</p>
      </div>
      <div>
        <label className="ps-rm-lbl" htmlFor={`${id}-n`}>{mode === 'complete' ? 'Сколько игр' : 'Не больше игр'}</label>
        <div className="ps-rm-stepper ps-rm-goalform__n">
          <button type="button" className="ps-btn ps-btn--icon ps-rm-sq" aria-label="Меньше на 1" disabled={busy} onClick={() => bump(-1)}>−</button>
          <span className="ps-rm-input" data-invalid={showErr ? 'true' : undefined}>
            <input
              id={`${id}-n`} type="number" inputMode="numeric" min={GOAL_MIN[mode]} max={GOAL_MAX} step={1} disabled={busy} value={text} data-testid="rm-goal-count"
              aria-invalid={showErr ? 'true' : undefined} aria-describedby={showErr ? `${id}-e` : hint ? `${id}-t` : undefined}
              onChange={(e) => { setText(e.target.value); setTouched(true); }}
              onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); bump(e.key === 'ArrowUp' ? 1 : -1); } }}
            />
          </span>
          <button type="button" className="ps-btn ps-btn--icon ps-rm-sq" aria-label="Больше на 1" disabled={busy} onClick={() => bump(1)}>+</button>
        </div>
        {showErr && <p className="ps-rm-ferr" id={`${id}-e`} role="alert"><Icon name="circle-alert" size={12} /><span>{goalRangeText(mode)}</span></p>}
      </div>
      {hint && <p className="ps-rm-hint" id={`${id}-t`}>{hint}</p>}
      {error && <p className="ps-rm-ferr ps-rm-ferr--form" role="alert" data-testid="rm-goal-error"><Icon name="circle-alert" size={16} /><span>{error}</span></p>}
      <div className="ps-rm-goalform__btns">
        <button type="submit" className="ps-btn ps-btn--primary" disabled={!canSave} aria-busy={busy || undefined}>
          {busy ? <><Spinner />Сохраняю…</> : 'Сохранить цель'}
        </button>
        <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} onClick={onCancel}>Отмена</button>
      </div>
    </form>
  );
}

function GoalCard({ goal, onEdit, onRemove }: { goal: GoalView; onEdit: () => void; onRemove: () => void }) {
  const mobile = useIsMobile();
  const st = goalState(goal);
  const pct = goalBarPercent(goal);
  const metrics = goalMetrics(goal);
  const required = st.showForecast ? goalRequiredText(goal) : null;
  const actions = st.canEdit ? (
    mobile ? (
      <Popover
        align="end"
        trigger={(p) => <button type="button" className="ps-iconbtn ps-rm-sq ps-rm-goal__more" aria-label="Действия с целью" {...p}><Icon name="more" size={18} /></button>}
      >
        {(close) => (
          <>
            <button type="button" role="menuitem" className="ps-menu-item ps-menu-item--tall" onClick={() => { close(); onEdit(); }}>
              <Icon name="pencil" size={16} /><span className="ps-menu-item__label">Изменить цель</span>
            </button>
            <button type="button" role="menuitem" className="ps-menu-item ps-menu-item--tall" onClick={() => { close(); onRemove(); }}>
              <Icon name="x" size={16} /><span className="ps-menu-item__label">Убрать цель</span>
            </button>
          </>
        )}
      </Popover>
    ) : (
      <>
        <button type="button" className="ps-iconbtn ps-rm-sq" aria-label="Изменить цель" title="Изменить цель" onClick={onEdit}><Icon name="pencil" size={16} /></button>
        <button type="button" className="ps-iconbtn ps-rm-sq" aria-label="Убрать цель" title="Убрать цель" onClick={onRemove}><Icon name="x" size={16} /></button>
      </>
    )
  ) : (
    <button type="button" className="ps-iconbtn ps-rm-sq" aria-label="Убрать цель" title="Убрать цель" onClick={onRemove}><Icon name="x" size={16} /></button>
  );
  return (
    <div data-testid="rm-goal-card" data-state={st.kind}>
      <div className="ps-rm-goal__head">
        <h3 className="ps-rm-goal__title">Цель на {goal.year} год: <span>{goalTitle(goal)}</span></h3>
        <div className="ps-rm-goal__act">{actions}</div>
      </div>
      <p className="ps-rm-status" data-state={st.kind} data-testid="rm-goal-status">
        {st.icon && <span className="ps-rm-ico" data-tone={st.tone ?? undefined}><Icon name={st.icon} size={20} /></span>}
        <span>{st.text}</span>
      </p>
      {st.note && <p className="ps-rm-note ps-rm-note--tight">{st.note}</p>}
      <div className="ps-rm-metrics">
        {metrics.map((m) => <div key={m.label}><span className="ps-micro">{m.label}</span><b className="num">{m.value}</b></div>)}
      </div>
      <div className="ps-rm-meter">
        <div
          className="ps-rm-meter__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={goalBarLabel(goal)}
        >
          <i style={{ width: `${pct}%` }} />
        </div>
        <small className="num">{pct}%</small>
      </div>
      {st.showForecast && (
        <>
          <p className="ps-rm-hint ps-rm-goal__fc">{goalForecastText(goal)}</p>
          <p className="ps-rm-note ps-rm-note--tight">{goalPaceText(goal)}{required ? `. ${required}` : ''}</p>
        </>
      )}
      <p className="ps-rm-note">{goalAsOfText(goal)}</p>
    </div>
  );
}

/** Блок «Цель года» (`#rm-goal`): пустое состояние, форма, карточка цели, удаление с отменой. Данные цели приходят с `GET /api/roadmap`. */
export function GoalPanel({
  goal, year, today, onChanged, onSettings,
}: { goal: GoalView | null; year: number; today: string; onChanged: (g: GoalView | null) => void; onSettings: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busyDel, setBusyDel] = useState(false);
  const goalRef = useRef(goal);
  goalRef.current = goal;
  const nowYear = Number(today.slice(0, 4));
  const past = year < nowYear;

  async function save(mode: GoalMode, count: number) {
    setBusy(true);
    setError(null);
    try {
      const r = await putGoal(mode, count);
      onChanged(r.goal);
      setEditing(false);
      toast({ text: 'Цель сохранена' });
    } catch (e) {
      const st = e instanceof ApiError ? goalSaveError(e.status, e.code) : { text: 'Нет связи с сервером.', settings: false };
      setError(st.text);
      toast({
        kind: 'error', text: st.settings ? 'Не удалось сохранить цель. Сначала сохрани настройки плана.' : 'Не удалось сохранить цель. Повтори',
        action: st.settings ? { label: 'К настройкам', run: onSettings } : { label: 'Повторить', run: () => void save(mode, count) },
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const prev = goalRef.current;
    setBusyDel(true);
    try {
      await deleteGoal();
    } catch {
      toast({ kind: 'error', text: 'Не удалось убрать цель. Повтори' });
      setBusyDel(false);
      return;
    }
    setBusyDel(false);
    setConfirm(false);
    onChanged(null);
    toast({
      text: 'Цель убрана', ttl: 8000,
      action: prev ? {
        label: 'Отменить',
        run: () => {
          putGoal(prev.mode, prev.count).then((r) => { onChanged(r.goal); toast({ text: 'Цель возвращена' }); })
            .catch(() => toast({ kind: 'error', text: 'Не удалось вернуть цель. Поставь её заново' }));
        },
      } : undefined,
    });
  }

  let body;
  if (editing) {
    body = <GoalForm initial={goal} year={year} busy={busy} error={error} onCancel={() => { setEditing(false); setError(null); }} onSave={(m, c) => void save(m, c)} />;
  } else if (goal) {
    body = (
      <>
        <GoalCard goal={goal} onEdit={() => { setError(null); setEditing(true); }} onRemove={() => setConfirm(true)} />
        {confirm && (
          <div className="ps-rm-confirm ps-rm-goal__del" role="alertdialog" aria-label={`Убрать цель на ${goal.year}?`}>
            <p>Убрать цель на {goal.year}?</p>
            <button type="button" className="ps-btn ps-btn--danger" disabled={busyDel} onClick={() => void remove()}>Убрать</button>
            <button type="button" className="ps-btn ps-btn--ghost" disabled={busyDel} autoFocus onClick={() => setConfirm(false)}>Отмена</button>
          </div>
        )}
      </>
    );
  } else {
    body = (
      <div className="ps-rm-goalempty" data-testid="rm-goal-empty">
        <span className="ps-rm-goalempty__ic" aria-hidden="true"><Icon name="check" size={40} /></span>
        {past ? (
          <h3 className="ps-h3">На {year} цели не было</h3>
        ) : (
          <>
            <h3 className="ps-h3">Цели на {year} пока нет</h3>
            <p>Поставь себе число: сколько игр пройти или до скольки сократить бэклог. Мы покажем, успеваешь ли.</p>
            <button type="button" className="ps-btn ps-btn--primary" onClick={() => { setError(null); setEditing(true); }}>Поставить цель</button>
          </>
        )}
      </div>
    );
  }
  return (
    <>
      <h2 className="ps-h2" id="rm-goal-h">Цель года</h2>
      {body}
    </>
  );
}
