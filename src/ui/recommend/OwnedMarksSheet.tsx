'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError } from '../collection/api';
import { Icon } from '../icons';
import { Sheet } from '../primitives/Sheet';
import { useToast } from '../primitives/Toast';
import { deleteOwnedMark, fetchOwnedMarks, type OwnedMark } from './api';
import {
  LIST_PAGE, FILTER_MIN_MARKS, MARK_FILTERS, markCounts, markDate, markLabel, matchesFilter, returnedText, sortMarks, type MarkFilter,
} from './owned-model';
import { OwnedThumb } from './OwnedSheet';

const COLLAPSE_MS = 200;

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready' };

function Item({ mark, busy, leaving, onReturn }: { mark: OwnedMark; busy: boolean; leaving: boolean; onReturn: () => void }) {
  const date = markDate(mark.updatedAt);
  return (
    <li className="ps-own-item" data-leaving={leaving || undefined} data-testid="owned-item">
      <OwnedThumb url={mark.coverUrl ?? mark.coveredBy?.imageUrl ?? null} name={mark.title} />
      <div className="ps-own-item__main">
        <p className="ps-own-item__name" title={mark.title}>{mark.title}</p>
        <p className="ps-own-item__sub">
          <span>{markLabel(mark)}</span>
          {date && <span className="ps-own-item__date">{date}</span>}
        </p>
      </div>
      <button
        type="button" className="ps-btn ps-btn--ghost ps-btn--sm ps-own-item__btn" disabled={busy}
        aria-label={`Вернуть в подборку: «${mark.title}»`} onClick={onReturn}
      >
        {busy ? <span className="ps-rec__spin" aria-hidden="true" /> : <Icon name="undo" size={14} />}
        {busy ? 'Возвращаю…' : 'Вернуть в подборку'}
      </button>
    </li>
  );
}

/** Лист «Отмеченные игры» (спека 16.5). `onChanged` вызывается после возврата: родитель перечитывает подборку. */
export function OwnedMarksSheet({ open, onClose, onCount, onChanged }: {
  open: boolean; onClose: () => void; onCount: (n: number) => void; onChanged: () => void;
}) {
  return <Sheet open={open} onClose={onClose} title="Отмеченные игры" className="ps-own-sheet ps-own-sheet--marks">
    <Body onClose={onClose} onCount={onCount} onChanged={onChanged} />
  </Sheet>;
}

function Body({ onClose, onCount, onChanged }: { onClose: () => void; onCount: (n: number) => void; onChanged: () => void }) {
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [marks, setMarks] = useState<OwnedMark[]>([]);
  const [filter, setFilter] = useState<MarkFilter>('all');
  const [limit, setLimit] = useState(LIST_PAGE);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [attempt, setAttempt] = useState(0);
  const filterRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const latest = useRef<(m: OwnedMark) => void>(() => {});

  useEffect(() => {
    const ac = new AbortController();
    fetchOwnedMarks(ac.signal)
      .then((r) => { setMarks(sortMarks(r.marks)); setLoad({ state: 'ready' }); })
      .catch((e: unknown) => {
        if (ac.signal.aborted || (e instanceof ApiError && e.status === 401)) return;
        setLoad({ state: 'error' });
      });
    return () => ac.abort();
  }, [attempt]);

  useEffect(() => { if (load.state === 'ready') onCount(marks.length); }, [load.state, marks.length, onCount]);

  const toggle = (set: (f: (s: ReadonlySet<string>) => ReadonlySet<string>) => void, id: string, on: boolean) =>
    set((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  const giveBack = useCallback(async (m: OwnedMark) => {
    toggle(setBusy, m.externalId, true);
    try {
      await deleteOwnedMark(m.externalId);
    } catch (e) {
      toggle(setBusy, m.externalId, false);
      if (!(e instanceof ApiError && e.status === 401)) {
        toast({ alert: true, text: 'Не удалось вернуть. Повтори', action: { label: 'Повторить', run: () => latest.current(m) } });
      }
      return;
    }
    toast({ text: returnedText(m.title), ttl: 6000 });
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    toggle(setLeaving, m.externalId, true);
    setTimeout(() => {
      setMarks((l) => l.filter((x) => x.externalId !== m.externalId));
      toggle(setBusy, m.externalId, false);
      toggle(setLeaving, m.externalId, false);
    }, reduce ? 0 : COLLAPSE_MS);
    onChanged();
  }, [toast, onChanged]);

  useEffect(() => { latest.current = (m) => void giveBack(m); });

  const counts = useMemo(() => markCounts(marks), [marks]);
  const visible = useMemo(() => marks.filter((m) => matchesFilter(m, filter)), [marks, filter]);
  const shown = visible.slice(0, limit);
  const showFilter = marks.length > FILTER_MIN_MARKS;

  function onFilterKey(e: KeyboardEvent, i: number) {
    let n = -1;
    const len = MARK_FILTERS.length;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % len;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i + len - 1) % len;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = len - 1;
    if (n < 0) return;
    e.preventDefault();
    setFilter(MARK_FILTERS[n].value);
    setLimit(LIST_PAGE);
    filterRefs.current[n]?.focus();
  }

  return (
    <div className="ps-own">
      <p className="ps-sheet__sub">Эти игры не попадают в подборку. Верни, если ошибся.</p>

      {load.state === 'loading' && (
        <ul className="ps-own-items" aria-busy="true" aria-label="Загрузка">
          {Array.from({ length: 4 }, (_, i) => <li key={i} className="ps-skeleton ps-own-sk ps-own-sk--item" aria-hidden="true" />)}
        </ul>
      )}

      {load.state === 'error' && (
        <div className="ps-rec-banner" role="alert">
          <Icon name="circle-alert" size={16} />
          <span>Не удалось загрузить список.</span>
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => { setLoad({ state: 'loading' }); setAttempt((n) => n + 1); }}>
            <Icon name="refresh" size={14} />Повторить
          </button>
        </div>
      )}

      {load.state === 'ready' && marks.length === 0 && (
        <div className="ps-own-empty">
          <Icon name="library" size={32} />
          <h3 className="ps-h3">Пока ничего не отмечено</h3>
          <p>Нажми «Уже есть / проходил» на карточке, и игра уйдёт из подборки. Здесь её можно вернуть.</p>
          <button type="button" className="ps-btn ps-btn--ghost" onClick={onClose}>Закрыть</button>
        </div>
      )}

      {load.state === 'ready' && marks.length > 0 && (
        <>
          {showFilter && (
            <div className="ps-seg ps-own-filter" role="radiogroup" aria-label="Фильтр отмеченных">
              {MARK_FILTERS.map((f, i) => (
                <button
                  key={f.value} ref={(el) => { filterRefs.current[i] = el; }} type="button" role="radio" aria-checked={filter === f.value}
                  tabIndex={filter === f.value ? 0 : -1} onClick={() => { setFilter(f.value); setLimit(LIST_PAGE); }} onKeyDown={(e) => onFilterKey(e, i)}
                >
                  {f.label} · <span className="num">{counts[f.value]}</span>
                </button>
              ))}
            </div>
          )}
          {visible.length === 0 ? (
            <div className="ps-own-empty">
              <p>В этом разделе пусто</p>
              <button type="button" className="ps-btn ps-btn--ghost" onClick={() => setFilter('all')}>Все</button>
            </div>
          ) : (
            <ul className="ps-own-items">
              {shown.map((m) => (
                <Item key={m.externalId} mark={m} busy={busy.has(m.externalId)} leaving={leaving.has(m.externalId)} onReturn={() => void giveBack(m)} />
              ))}
            </ul>
          )}
          {visible.length > shown.length && (
            <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm ps-own-more" onClick={() => setLimit((n) => n + LIST_PAGE)}>Показать ещё</button>
          )}
          <p className="ps-own-note">Если игра есть в сегодняшней подборке, она вернётся сразу. Иначе появится после ночного синка.</p>
        </>
      )}
    </div>
  );
}
