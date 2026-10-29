'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icons';
import { hoursFieldValue, hoursNum, parseRowHours, ROW_HOURS_MAX, ROW_HOURS_MIN } from './model';

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="ps-rm-spin" style={{ width: size, height: size }} aria-hidden="true" />;
}

/** Миниатюра без наложенного текста: нет картинки или ошибка загрузки = плейсхолдер с первой буквой. */
export function Thumb({ url, title, w, h }: { url: string | null; title: string; w: number; h: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  const bad = !url || failed === url;
  return (
    <span className="ps-rm-thumb" style={{ width: w, height: h }} data-empty={bad || undefined}>
      {bad ? (
        <span aria-hidden="true">{title.trim().charAt(0).toUpperCase()}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- внешние обложки RAWG/PSN, как в остальном проекте
        <img src={url} alt="" decoding="async" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(url)} />
      )}
    </span>
  );
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className="ps-rm-ferr" id={id} role="alert">
      <Icon name="circle-alert" size={12} />
      <span>{children}</span>
    </p>
  );
}

export const reducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Прокрутка к элементу, подсветка на 1,2 с (data-flash) и фокус. */
export function flashElement(el: HTMLElement | null, focus?: HTMLElement | null) {
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  el.setAttribute('data-flash', 'true');
  window.setTimeout(() => el.removeAttribute('data-flash'), 1200);
  (focus ?? el).focus({ preventScroll: true });
}

/** К строке игры в «Очереди» или «Релизах» (по key). */
export function jumpToEntry(key: string) {
  const sel = (zone: string) => document.querySelector<HTMLElement>(`[data-rm-zone="${zone}"][data-rm-key="${key}"]`);
  flashElement(sel('queue') ?? sel('releases'));
}

/**
 * Поле часов с сохранением на blur и Enter. Пусто = часы не заданы (если allowEmpty).
 * onSave бросает исключение при ошибке: поле остаётся с введённым значением.
 */
export function HoursField({
  value, label, onSave, allowEmpty = true,
}: {
  value: number | null; label: string; onSave: (hours: number | null) => Promise<void>; allowEmpty?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(hoursFieldValue(value));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const last = useRef(value);
  useEffect(() => {
    if (last.current !== value) {
      last.current = value;
      // значение пришло с сервера (после пересчёта): синхронизируем поле
      setText(hoursFieldValue(value));
    }
  }, [value]);

  async function commit() {
    if (busy) return;
    const empty = text.trim() === '';
    const parsed = empty ? null : parseRowHours(text);
    if ((empty && !allowEmpty) || (!empty && parsed === null)) {
      setErr(`Введи число от ${hoursNum(ROW_HOURS_MIN)} до ${ROW_HOURS_MAX}`);
      return;
    }
    setErr(null);
    if (parsed === value) return;
    setBusy(true);
    try {
      await onSave(parsed);
    } catch {
      setErr('Не удалось сохранить. Повтори');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ps-rm-hours">
      <label className="ps-rm-hours__l" htmlFor={id}>{label}</label>
      <span className="ps-rm-input ps-rm-input--sfx" data-invalid={err ? 'true' : undefined} aria-busy={busy || undefined}>
        <input
          id={id} type="text" inputMode="decimal" value={text} disabled={busy} autoComplete="off"
          aria-invalid={err ? 'true' : undefined} aria-describedby={err ? `${id}-e` : undefined}
          onChange={(e) => { setText(e.target.value); setErr(null); }}
          onBlur={() => void commit()}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commit(); } }}
        />
        {busy ? <Spinner size={12} /> : <span className="ps-rm-sfx" aria-hidden="true">ч</span>}
      </span>
      {err && <FieldError id={`${id}-e`}>{err}</FieldError>}
    </div>
  );
}
