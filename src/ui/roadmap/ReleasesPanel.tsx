'use client';

import { useId, useState } from 'react';
import type { PlannedGameDto, RoadmapResponse } from '@/server/roadmap/types';
import { Icon } from '../icons';
import { HoursField, Thumb } from './parts';
import { dayYearText, isReleased, outsideYear, plannedPlanState, type PlannedBody } from './model';
import { ReleaseSheet } from './ReleaseSheet';

export function Attribution() {
  return (
    <p className="ps-rm-attr">
      Данные:{' '}
      <a href="https://rawg.io" target="_blank" rel="noopener noreferrer" aria-label="Данные: RAWG (откроется в новой вкладке)">
        RAWG<Icon name="external-link" size={12} />
      </a>
    </p>
  );
}

type RowProps = {
  g: PlannedGameDto; data: RoadmapResponse | null; today: string; year: number;
  onPatch: (id: number, patch: Partial<Omit<PlannedBody, 'externalSource' | 'externalId'>>) => Promise<void>;
  onEdit: (g: PlannedGameDto) => void; onRemove: (g: PlannedGameDto) => Promise<void>; onUnallocate: (g: PlannedGameDto) => void;
};

function ReleaseRow({ g, data, today, year, onPatch, onEdit, onRemove, onUnallocate }: RowProps) {
  const id = useId();
  const [want, setWant] = useState<boolean | null>(null); // оптимистичное значение, пока идёт сохранение
  const [confirm, setConfirm] = useState(false);
  const [busyDel, setBusyDel] = useState(false);
  const shown = want ?? g.wantAtRelease;
  const st = data ? plannedPlanState(g.id, data) : null;
  const noDate = g.releaseDate === null;

  async function toggle(next: boolean) {
    setWant(next);
    try { await onPatch(g.id, { wantAtRelease: next }); } catch { /* откат и тост в родителе */ } finally { setWant(null); }
  }
  async function del() {
    setBusyDel(true);
    try { await onRemove(g); } catch { setBusyDel(false); setConfirm(false); }
  }

  return (
    <li className="ps-rm-rel__item" data-rm-zone="releases" data-rm-key={`p:${g.id}`} tabIndex={-1} data-testid="rm-release">
      <Thumb url={g.coverUrl} title={g.title} w={48} h={64} />
      <div className="ps-rm-rel__body">
        <h3 className="ps-rm-rel__t" title={g.title}>{g.title}</h3>
        <p className="ps-rm-rel__meta">
          {noDate ? <span className="ps-rm-muted">Дата уточняется</span> : <span className="num"><Icon name="calendar" size={12} />{dayYearText(g.releaseDate as string)}</span>}
          {isReleased(g, today) && <span className="ps-rm-tag">Уже вышла</span>}
          <span>{g.externalSource === 'rawg' ? 'Из каталога RAWG' : 'Добавлено вручную'}</span>
          {outsideYear(g.releaseDate, year) && <span>Вне {year}</span>}
        </p>
        <HoursField value={g.hoursManual} label="Часов на прохождение" onSave={(h) => onPatch(g.id, { hoursManual: h })} />
        <label className="ps-rm-check" data-disabled={noDate || undefined}>
          <input type="checkbox" checked={shown && !noDate} disabled={noDate || want !== null} aria-describedby={`${id}-s`} onChange={(e) => void toggle(e.target.checked)} />
          <span>Хочу пройти на релизе</span>
        </label>
        <p className="ps-rm-muted" id={`${id}-s`}>
          {noDate ? 'Нужна дата релиза' : shown ? 'В плане с даты выхода' : 'Идёт в очереди после бэклога'}
          {st?.kind === 'need_hours' && ' · нужны часы'}
          {st?.kind === 'not_fit' && ' · не успеваю'}
          {st && st.conflicts.length > 0 && <> · <a href={`#rm-conflict-${st.conflicts[0]}`}>конфликт {st.conflicts[0]}</a></>}
        </p>
      </div>
      <div className="ps-rm-rel__act">
        <button type="button" className="ps-iconbtn ps-rm-sq" aria-label={`Изменить: ${g.title}`} onClick={() => onEdit(g)}><Icon name="pencil" size={16} /></button>
        <button type="button" className="ps-iconbtn ps-rm-sq" aria-label={`Убрать из плана: ${g.title}`} title="Убрать из плана" onClick={() => onUnallocate(g)}><Icon name="eye-off" size={16} /></button>
        <button type="button" className="ps-iconbtn ps-rm-sq" aria-label={`Удалить: ${g.title}`} aria-expanded={confirm} onClick={() => setConfirm((v) => !v)}><Icon name="trash" size={16} /></button>
      </div>
      {confirm && (
        <div className="ps-rm-rel__del" role="alertdialog" aria-label={`Удалить «${g.title}» из плана?`}>
          <p>Удалить «{g.title}» из плана?</p>
          <div>
            <button type="button" className="ps-btn ps-btn--danger" disabled={busyDel} onClick={() => void del()}>Удалить</button>
            <button type="button" className="ps-btn ps-btn--ghost" disabled={busyDel} autoFocus onClick={() => setConfirm(false)}>Отмена</button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Блок «Релизы»: невышедшие игры (RAWG или вручную), галка «Хочу пройти на релизе», правка, удаление. */
export function ReleasesPanel({
  planned, error, data, today, year, onRetry, onAdd, onPatch, onRemove, onUnallocate,
}: {
  planned: PlannedGameDto[] | null; error: boolean; data: RoadmapResponse | null; today: string; year: number; onRetry: () => void;
  onAdd: (body: PlannedBody, withExternal: boolean) => Promise<void>;
  onPatch: (id: number, patch: Partial<Omit<PlannedBody, 'externalSource' | 'externalId'>>) => Promise<void>;
  onRemove: (g: PlannedGameDto) => Promise<void>; onUnallocate: (g: PlannedGameDto) => void;
}) {
  const [dlg, setDlg] = useState<{ game: PlannedGameDto | null } | null>(null);
  const addBtn = (
    <button type="button" className="ps-btn ps-btn--primary ps-btn--sm ps-rm-add" onClick={() => setDlg({ game: null })}>
      <Icon name="plus" size={14} />Добавить игру
    </button>
  );
  return (
    <>
      <div className="ps-rm-head">
        <h2 className="ps-h2">Релизы {planned && <small className="num ps-rm-cnt">{planned.length}</small>}</h2>
        {planned && planned.length > 0 && addBtn}
      </div>
      {error && !planned ? (
        <div className="ps-rm-empty" role="alert">
          <Icon name="circle-alert" size={40} />
          <h3 className="ps-h3">Не удалось загрузить релизы</h3>
          <button type="button" className="ps-btn" onClick={onRetry}>Повторить</button>
        </div>
      ) : !planned ? (
        <div aria-busy="true" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i} className="ps-skeleton ps-rm-sk-rel" />)}</div>
      ) : planned.length === 0 ? (
        <div className="ps-rm-empty">
          <Icon name="calendar-plus" size={40} />
          <h3 className="ps-h3">Релизов пока нет</h3>
          <p>Добавь игру, которая ещё не вышла, и отметь «Хочу пройти на релизе»: план освободит недели под дату выхода.</p>
          {addBtn}
        </div>
      ) : (
        <ul className="ps-rm-rel">
          {planned.map((g) => (
            <ReleaseRow key={g.id} g={g} data={data} today={today} year={year} onPatch={onPatch} onEdit={(x) => setDlg({ game: x })} onRemove={onRemove} onUnallocate={onUnallocate} />
          ))}
        </ul>
      )}
      <Attribution />
      {dlg && (
        <ReleaseSheet
          key={dlg.game?.id ?? 'new'} game={dlg.game} year={year} onClose={() => setDlg(null)}
          onSubmit={async (body, withExternal) => {
            if (dlg.game) {
              const { externalSource: _s, externalId: _i, ...rest } = body; // eslint-disable-line @typescript-eslint/no-unused-vars
              await onPatch(dlg.game.id, rest);
            } else await onAdd(body, withExternal);
          }}
        />
      )}
    </>
  );
}
