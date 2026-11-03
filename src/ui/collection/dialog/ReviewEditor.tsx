'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { GameItem, GameReview } from '@/server/collection/types';
import { NOTE_MAX, noteLength, RATING_MAX, RATING_MIN } from '@/shared/review';
import { ApiError, errorText, putReview } from '../api';

/** Пауза ввода заметки перед сохранением (F1). Оценка сохраняется сразу; blur и закрытие окна сохраняют без ожидания. */
export const NOTE_DEBOUNCE_MS = 800;
const SCORES = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i);

type Saved = { rating: number | null; note: string | null };
type Phase = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; text: string };

const normNote = (s: string) => {
  const t = s.replace(/\r\n?/g, '\n').trim();
  return t === '' ? null : t;
};

/**
 * «Моя оценка» в окне игры (F1, контракт F1): 11 шагов 0–10 (0 — настоящая оценка, «Сбросить» = без оценки) и заметка ≤500.
 * Запросы идут по одному: новая правка ждёт ответа предыдущей и уходит с последними значениями (порядок на сервере = порядок правок).
 */
export function ReviewEditor({ game, review, onChanged }: { game: GameItem; review: GameReview | null; onChanged?: (g: GameItem) => void }) {
  const hId = useId();
  const noteId = useId();
  const cntId = useId();
  const [rating, setRating] = useState<number | null>(review?.rating ?? null);
  const [note, setNote] = useState(review?.note ?? '');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const saved = useRef<Saved>({ rating: review?.rating ?? null, note: review?.note ?? null });
  const want = useRef<Saved>({ rating: review?.rating ?? null, note: review?.note ?? null });
  const inflight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const changedCb = useRef(onChanged);
  useEffect(() => { changedCb.current = onChanged; }, [onChanged]);

  const len = noteLength(note);
  const tooLong = len > NOTE_MAX;

  async function pump(keepalive = false) {
    if (inflight.current) return;
    const w = want.current;
    const s = saved.current;
    if (w.rating === s.rating && w.note === s.note) return;
    if (w.note !== null && noteLength(w.note) > NOTE_MAX) return;
    inflight.current = true;
    if (alive.current) setPhase({ kind: 'saving' });
    try {
      const r = await putReview(game.id, { rating: w.rating, note: w.note }, keepalive ? { keepalive: true } : undefined);
      saved.current = { rating: r.review?.rating ?? null, note: r.review?.note ?? null };
      changedCb.current?.(r.game);
      if (alive.current) setPhase({ kind: 'saved' });
    } catch (e) {
      if (alive.current) setPhase({ kind: 'error', text: e instanceof ApiError && e.status === 400 ? 'Сервер не принял оценку или заметку.' : `Не сохранено. ${errorText(e)}` });
      inflight.current = false;
      return;
    }
    inflight.current = false;
    // за время запроса пришли новые правки: отправить последние значения
    if (want.current.rating !== saved.current.rating || want.current.note !== saved.current.note) void pump(keepalive);
  }

  function flush(keepalive = false) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    void pump(keepalive);
  }

  // закрытие окна с несохранённой заметкой: отправить сразу (keepalive переживает размонтирование)
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void pump(true);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickRating(r: number | null) {
    setRating(r);
    want.current = { ...want.current, rating: r };
    flush();
  }

  function editNote(v: string) {
    setNote(v);
    want.current = { ...want.current, note: normNote(v) };
    if (timer.current) clearTimeout(timer.current);
    if (noteLength(v) > NOTE_MAX) {
      setPhase({ kind: 'idle' });
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      void pump();
    }, NOTE_DEBOUNCE_MS);
  }

  const status =
    tooLong ? `Заметка длиннее ${NOTE_MAX} символов — не сохранена.`
      : phase.kind === 'saving' ? 'Сохраняю…'
        : phase.kind === 'saved' ? 'Сохранено'
          : phase.kind === 'error' ? phase.text
            : '';

  return (
    <section className="ps-gd__sec ps-gd__review" aria-labelledby={hId} data-testid="game-review">
      <div className="ps-gd__rvh">
        <h3 id={hId}>Моя оценка</h3>
        <span className="ps-gd__rvv num" data-empty={rating === null || undefined} data-testid="review-value">
          {rating === null ? 'без оценки' : <><b>{rating}</b>/10</>}
        </span>
      </div>
      <fieldset className="ps-rate" aria-describedby={`${hId}-hint`}>
        <legend className="ps-sr">Оценка от {RATING_MIN} до {RATING_MAX}</legend>
        {SCORES.map((n) => (
          <label key={n} className="ps-rate__opt" data-on={rating !== null && n <= rating ? true : undefined} data-picked={rating === n || undefined}>
            <input type="radio" name={`${hId}-r`} value={n} checked={rating === n} onChange={() => pickRating(n)} className="ps-rate__in" />
            <span className="num">{n}</span>
          </label>
        ))}
      </fieldset>
      <div className="ps-gd__rvfoot">
        <span id={`${hId}-hint`} className="ps-gd__rvhint">0 — тоже оценка</span>
        {rating !== null && (
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm ps-gd__rvreset" onClick={() => pickRating(null)}>Сбросить оценку</button>
        )}
      </div>
      <label className="ps-gd__rvlbl" htmlFor={noteId}>Заметка</label>
      <textarea
        id={noteId} className="ps-input ps-gd__rvnote" rows={3} value={note} placeholder="Что запомнилось, за что оценка…"
        aria-describedby={cntId} aria-invalid={tooLong || undefined}
        onChange={(e) => editNote(e.target.value)} onBlur={() => flush()}
      />
      <div className="ps-gd__rvfoot">
        <span className="ps-gd__rvstate" role="status" data-kind={tooLong ? 'error' : phase.kind}>{status}</span>
        <span id={cntId} className="ps-gd__rvcnt num" data-over={tooLong || undefined}>{len}/{NOTE_MAX}</span>
      </div>
    </section>
  );
}
