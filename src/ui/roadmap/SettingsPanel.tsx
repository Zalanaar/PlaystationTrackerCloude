'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { SettingsView } from '@/server/roadmap/types';
import { Icon } from '../icons';
import { BUDGET_MAX, BUDGET_MIN, BUDGET_STEP, budgetHint, parseBudget, yearOptions } from './model';
import { FieldError, Spinner } from './parts';

const DEFAULT_HOURS = 10;

/** Повтор шага по долгому нажатию на «−»/«+». */
function useRepeat(step: () => void) {
  const stepRef = useRef(step);
  useEffect(() => { stepRef.current = step; });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iv = useRef<ReturnType<typeof setInterval> | null>(null);
  const fired = useRef(false);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    if (iv.current) clearInterval(iv.current);
    timer.current = null;
    iv.current = null;
  };
  useEffect(() => stop, []);
  return {
    onPointerDown: () => {
      fired.current = false;
      timer.current = setTimeout(() => {
        fired.current = true;
        iv.current = setInterval(() => stepRef.current(), 120);
      }, 450);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: (e: { detail: number }) => { if (!fired.current || e.detail === 0) stepRef.current(); fired.current = false; },
  };
}

/** Настройки плана: год и часов в неделю. Первый запуск (`welcome`) = приветственная панель с кнопкой «Составить план». */
export function SettingsPanel({
  settings, today, busy, welcome, onApply,
}: { settings: SettingsView; today: string; busy: boolean; welcome: boolean; onApply: (year: number, hours: number) => void }) {
  const saved = settings.hoursPerWeek ?? DEFAULT_HOURS;
  const [year, setYear] = useState(settings.year);
  const [text, setText] = useState(String(saved).replace('.', ','));
  const [touched, setTouched] = useState(false);
  const id = useId();
  const { min, max } = yearOptions(today);
  const parsed = parseBudget(text);
  const invalid = parsed === null;
  const dirty = welcome || year !== settings.year || parsed !== settings.hoursPerWeek;
  const canApply = !busy && !invalid && dirty;

  // сохранённые значения изменились (после ответа сервера): форма следует за ними
  const key = `${settings.year}|${settings.hoursPerWeek}`;
  const seen = useRef(key);
  useEffect(() => {
    if (seen.current === key) return;
    seen.current = key;
    setYear(settings.year);
    setText(String(settings.hoursPerWeek ?? DEFAULT_HOURS).replace('.', ','));
    setTouched(false);
  }, [key, settings.year, settings.hoursPerWeek]);

  function bump(delta: number) {
    setText((t) => {
      const cur = parseBudget(t) ?? saved;
      const next = Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, Math.round((cur + delta) * 10) / 10));
      return String(next).replace('.', ',');
    });
    setTouched(true);
  }
  const less = useRepeat(() => bump(-BUDGET_STEP));
  const more = useRepeat(() => bump(BUDGET_STEP));

  function submit() {
    setTouched(true);
    if (canApply && parsed !== null) onApply(year, parsed);
  }

  const showErr = invalid && (touched || text.trim() !== '');
  return (
    <form className="ps-rm-set" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="ps-rm-set__field">
        <span className="ps-rm-lbl" id={`${id}-y`}>Год</span>
        <div className="ps-rm-year" role="group" aria-labelledby={`${id}-y`}>
          <button type="button" className="ps-iconbtn ps-rm-sq" aria-label="Предыдущий год" disabled={busy || year <= min} onClick={() => setYear((y) => y - 1)}>
            <Icon name="chevron-left" size={18} />
          </button>
          <b className="num" aria-live="polite">{year}</b>
          <button type="button" className="ps-iconbtn ps-rm-sq" aria-label="Следующий год" disabled={busy || year >= max} onClick={() => setYear((y) => y + 1)}>
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      </div>
      <div className="ps-rm-set__field">
        <label className="ps-rm-lbl" htmlFor={`${id}-h`}>Часов в неделю</label>
        <div className="ps-rm-stepper">
          <button type="button" className="ps-btn ps-btn--icon ps-rm-sq" aria-label="Меньше на 0,5 ч" disabled={busy} {...less}>−</button>
          <span className="ps-rm-input ps-rm-input--sfx" data-invalid={showErr ? 'true' : undefined}>
            <input
              id={`${id}-h`} type="number" inputMode="decimal" min={BUDGET_MIN} max={BUDGET_MAX} step={BUDGET_STEP} disabled={busy}
              value={text.replace(',', '.')}
              aria-invalid={showErr ? 'true' : undefined} aria-describedby={showErr ? `${id}-e` : `${id}-t`}
              onChange={(e) => { setText(e.target.value); setTouched(true); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); bump(e.key === 'ArrowUp' ? BUDGET_STEP : -BUDGET_STEP); }
              }}
            />
            <span className="ps-rm-sfx" aria-hidden="true">ч</span>
          </span>
          <button type="button" className="ps-btn ps-btn--icon ps-rm-sq" aria-label="Больше на 0,5 ч" disabled={busy} {...more}>+</button>
        </div>
        {showErr && <FieldError id={`${id}-e`}>Введи число от 0,5 до 100</FieldError>}
      </div>
      <p className="ps-rm-hint" id={`${id}-t`}>{budgetHint(year, parsed, today)}</p>
      <button type="submit" className="ps-btn ps-btn--primary ps-rm-apply" disabled={!canApply} aria-busy={busy || undefined}>
        {busy ? <><Spinner />Считаю…</> : welcome ? 'Составить план' : 'Применить'}
      </button>
    </form>
  );
}
