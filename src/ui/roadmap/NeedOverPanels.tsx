'use client';

import { useId, useState } from 'react';
import type { NotFitEntry, RoadmapEntry } from '@/server/roadmap/types';
import { Icon } from '../icons';
import { dayText, hoursLabel, notFitReasonText, notFitShortText, parseRowHours, ROW_HOURS_MAX, ROW_HOURS_MIN, hoursNum, totalShortHours } from './model';
import { FieldError, jumpToEntry, Spinner, Thumb } from './parts';

function NeedRow({ e, onSave }: { e: RoadmapEntry; onSave: (key: string, hours: number) => Promise<void> }) {
  const id = useId();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const kind = e.kind === 'backlog' ? 'Бэклог · нет на HLTB' : 'Релиз';

  async function save() {
    if (busy) return;
    const h = parseRowHours(text);
    if (h === null) { setErr(`Введи число от ${hoursNum(ROW_HOURS_MIN)} до ${ROW_HOURS_MAX}`); return; }
    setErr(null);
    setBusy(true);
    try { await onSave(e.key, h); } catch { setErr('Не удалось сохранить часы. Повтори'); setBusy(false); }
  }

  return (
    <li className="ps-rm-need__item" data-rm-need={e.key} data-testid="rm-need-row" tabIndex={-1}>
      <Thumb url={e.coverUrl} title={e.title} w={36} h={48} />
      <div className="ps-rm-need__name"><b title={e.title}>{e.title}</b><small>{kind}</small></div>
      <form className="ps-rm-need__form" noValidate onSubmit={(ev) => { ev.preventDefault(); void save(); }}>
        <span className="ps-rm-input ps-rm-input--sfx ps-rm-input--w" data-invalid={err ? 'true' : undefined}>
          <input
            id={id} type="text" inputMode="decimal" value={text} disabled={busy} autoComplete="off" aria-label={`Часов на прохождение: ${e.title}`}
            aria-invalid={err ? 'true' : undefined} aria-describedby={err ? `${id}-e` : undefined}
            onChange={(ev) => { setText(ev.target.value); setErr(null); }}
          />
          <span className="ps-rm-sfx" aria-hidden="true">ч</span>
        </span>
        <button type="submit" className="ps-btn ps-btn--ghost ps-btn--sm ps-rm-need__btn" disabled={busy}>{busy ? <><Spinner size={12} />Сохраняю…</> : 'Сохранить'}</button>
      </form>
      {err && <div className="ps-rm-need__err"><FieldError id={`${id}-e`}>{err}</FieldError></div>}
    </li>
  );
}

/** Блок «Нужны часы»: игры без длительности. Скрыт, если пусто. */
export function NeedHoursPanel({ list, onSave }: { list: readonly RoadmapEntry[]; onSave: (key: string, hours: number) => Promise<void> }) {
  if (!list.length) return null;
  return (
    <>
      <div className="ps-rm-head">
        <h2 className="ps-h2 ps-h2--ic"><Icon name="clock" size={16} />Нужны часы <small className="num ps-rm-cnt">{list.length}</small></h2>
      </div>
      <p className="ps-rm-sub">Без часов игру нельзя поставить на таймлайн. Введи примерную длительность.</p>
      <ul className="ps-rm-need">{list.map((e) => <NeedRow key={e.key} e={e} onSave={onSave} />)}</ul>
    </>
  );
}

/** Блок «Не успеваю»: игры, не влезшие в год. Скрыт, если пусто. Кнопки «Применить N ч в неделю» нет (решение Артёма). */
export function OverPanel({ list, yearEnd }: { list: readonly NotFitEntry[]; yearEnd: string }) {
  if (!list.length) return null;
  const total = totalShortHours(list);
  return (
    <>
      <div className="ps-rm-head">
        <h2 className="ps-h2 ps-h2--ic"><Icon name="alert" size={16} />Не успеваю <small className="num ps-rm-cnt">{list.length}</small></h2>
      </div>
      {total > 0 && <p className="ps-rm-over__sum">Не хватает <b className="num">{hoursLabel(total)}</b>, чтобы пройти всё до {dayText(yearEnd)}</p>}
      <ul className="ps-rm-over">
        {list.map((r) => (
          <li key={r.key}>
            <button type="button" className="ps-rm-over__row" data-testid="rm-over-row" onClick={() => jumpToEntry(r.key)}>
              <Thumb url={r.coverUrl} title={r.title} w={32} h={42} />
              <span className="ps-rm-over__tx"><b title={r.title}>{r.title}</b><small>{notFitReasonText(r)}</small></span>
              <span className="ps-rm-over__h num">{notFitShortText(r)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
