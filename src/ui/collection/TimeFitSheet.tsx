'use client';

import { useEffect, useState } from 'react';
import type { TimeFitItem, TimeFitResponse } from '@/server/collection/time-fit';
import { Sheet } from '../primitives/Sheet';
import { Icon } from '../icons';
import { Cover, THUMB_W } from './Cover';
import { errorText, fetchTimeFit } from './api';
import { FIT_EMPTY, FIT_HINT, FIT_NONE, TIME_OPTIONS, fitMeta } from './timeFit';

/** П12.5: окно «У меня 2 часа» — выбор времени, «Успеешь пройти» и «Продолжить»; строка открывает окно игры. */
export function TimeFitSheet({ open, onClose, onOpenGame }: { open: boolean; onClose: () => void; onOpenGame: (id: number) => void }) {
  const [minutes, setMinutes] = useState(120);
  const [data, setData] = useState<TimeFitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    fetchTimeFit(minutes, ac.signal).then(
      (r) => { if (!ac.signal.aborted) { setData(r); setError(null); } },
      (e) => { if (!ac.signal.aborted) setError(errorText(e)); },
    );
    return () => ac.abort();
  }, [open, minutes]);

  const shown = data && data.minutes === minutes ? data : null;
  const row = (i: TimeFitItem) => (
    <li key={i.id}>
      <button type="button" className="ps-tfit__row" data-testid="tfit-row" onClick={() => { onClose(); onOpenGame(i.id); }}>
        <Cover url={i.coverUrl} title={i.title} className="ps-tfit__thumb" w={THUMB_W} />
        <span className="ps-tfit__text">
          <span className="ps-tfit__title">{i.title}</span>
          <span className="ps-tfit__meta num">{fitMeta(i, minutes)}</span>
        </span>
        <Icon name="chevron-right" size={16} />
      </button>
    </li>
  );

  return (
    <Sheet open={open} onClose={onClose} title="Сколько есть времени?" className="ps-tfit">
      <div className="ps-seg ps-tfit__seg" role="group" aria-label="Время">
        {TIME_OPTIONS.map((o) => (
          <button key={o.minutes} type="button" aria-pressed={minutes === o.minutes} onClick={() => setMinutes(o.minutes)}>{o.label}</button>
        ))}
      </div>
      <p className="ps-tfit__hint">{FIT_HINT}</p>
      <div className="ps-tfit__body" aria-busy={!shown && !error} data-testid="tfit-body">
        {error && !shown ? (
          <p className="ps-tfit__empty" role="alert">Не удалось подобрать игры. {error}</p>
        ) : !shown ? (
          <div className="ps-tfit__sk" aria-hidden="true"><span className="ps-skeleton" /><span className="ps-skeleton" /><span className="ps-skeleton" /></div>
        ) : (
          <>
            <h3 className="ps-tfit__h">Успеешь пройти</h3>
            {shown.finish.length > 0
              ? <ul className="ps-tfit__list" data-testid="tfit-finish">{shown.finish.map(row)}</ul>
              : <p className="ps-tfit__empty" data-testid="tfit-empty">{shown.resume.length > 0 ? FIT_EMPTY : FIT_NONE}</p>}
            {shown.resume.length > 0 && (
              <>
                <h3 className="ps-tfit__h">Продолжить</h3>
                <ul className="ps-tfit__list" data-testid="tfit-resume">{shown.resume.map(row)}</ul>
              </>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
