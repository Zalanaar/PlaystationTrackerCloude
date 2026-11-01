'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { markGamePushed } from '../collection/useGameLink';
import { Icon, StatusGlyph } from '../icons';
import { Popover } from '../primitives/Popover';
import {
  backlogKeys, backlogPositions, conflictNumbers, dayText, dropOrder, dropSide, hoursLabel, hoursSourceLabel, moveTo, notFitShortText, periodText, positionText, weeksText, type QueueRow,
} from './model';
import { flashElement, reducedMotion, Thumb } from './parts';
import { plural } from '../format';
import type { Conflict } from '@/server/roadmap/types';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type Btn = 'up' | 'down' | 'menu';
type Over = { key: string; side: 'before' | 'after' };

function PlanCell({ row, conflicts }: { row: QueueRow; conflicts: number[] }) {
  const { state, item, notFit } = row;
  return (
    <div className="ps-rm-q__plan">
      {state === 'not_fit' && notFit ? (
        <span className="ps-rm-state" data-tone="danger" title={`${notFitShortText(notFit)[0].toUpperCase()}${notFitShortText(notFit).slice(1)}`}><Icon name="alert" size={12} />Не успеваю</span>
      ) : !row.movable && state === 'need_hours' && row.entry.releaseDate ? (
        <>
          <span className="ps-rm-state" data-tone="warning"><Icon name="clock" size={12} />Нужны часы</span>
          <small className="num">выходит {dayText(row.entry.releaseDate)}</small>
        </>
      ) : item ? (
        <>
          <span className="num">{periodText(item)}</span>
          <small className="num">{row.key.startsWith('p:') && item.releaseDate ? `выходит ${dayText(item.releaseDate)} · ` : ''}{weeksText(item.days)}</small>
        </>
      ) : (
        <span className="ps-rm-muted" aria-label="Нет дат">—</span>
      )}
      {conflicts.length > 0 && <a className="ps-rm-q__conf" href={`#rm-conflict-${conflicts[0]}`}><Icon name="alert" size={12} />Конфликт {conflicts[0]}</a>}
    </div>
  );
}

/** Блок «Очередь бэклога»: ручной порядок. Drag&drop (мышь), кнопки «выше/ниже», Alt+стрелки, меню «⋯». */
export function QueuePanel({
  rows, conflicts, error, loading, saveState, onReorder, onRetry, onRetrySave, onNeedHours, onRemove,
}: {
  rows: QueueRow[] | null; conflicts: readonly Conflict[]; error: boolean; loading: boolean; saveState: SaveState;
  onReorder: (keys: string[]) => void; onRetry: () => void; onRetrySave: () => void; onNeedHours: (key: string) => void;
  onRemove: (e: QueueRow['entry']) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  const [live, setLive] = useState('');
  const focusReq = useRef<{ key: string; btn: Btn } | null>(null);
  const tops = useRef<Map<string, number>>(new Map());
  const nums = conflictNumbers(conflicts as Conflict[]);
  const keys = backlogKeys(rows ?? []);
  const positions = backlogPositions(rows ?? []);
  const orderSig = (rows ?? []).map((r) => r.key).join('|');

  // FLIP при смене порядка + возврат фокуса на кнопку той же строки
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const next = new Map<string, number>();
    const els = Array.from(list.querySelectorAll<HTMLElement>(':scope > li[data-rm-key]'));
    for (const el of els) next.set(el.dataset.rmKey as string, el.offsetTop);
    if (!reducedMotion()) {
      for (const el of els) {
        const prev = tops.current.get(el.dataset.rmKey as string);
        const now = next.get(el.dataset.rmKey as string);
        if (prev !== undefined && now !== undefined && prev !== now) {
          el.animate([{ transform: `translateY(${prev - now}px)` }, { transform: 'translateY(0)' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
        }
      }
    }
    tops.current = next;
    const req = focusReq.current;
    if (req) {
      focusReq.current = null;
      const li = list.querySelector<HTMLElement>(`:scope > li[data-rm-key="${req.key}"]`);
      const pick = (b: Btn) => li?.querySelector<HTMLElement>(`[data-act="${b}"]`) ?? null;
      let btn = pick(req.btn);
      if (btn?.getAttribute('aria-disabled') === 'true') btn = pick(req.btn === 'up' ? 'down' : req.btn === 'down' ? 'up' : 'menu') ?? btn;
      btn?.focus();
    }
  }, [orderSig]);

  function move(key: string, how: 'up' | 'down' | 'start' | 'end', btn: Btn | null) {
    const i = keys.indexOf(key);
    if (i < 0) return;
    const to = how === 'up' ? i - 1 : how === 'down' ? i + 1 : how === 'start' ? 0 : keys.length - 1;
    if (to < 0 || to >= keys.length || to === i) return;
    focusReq.current = btn ? { key, btn } : null;
    onReorder(moveTo(keys, i, to));
    const title = rows?.find((r) => r.key === key)?.entry.title ?? 'Игра';
    setLive(positionText(title, to, keys.length));
  }

  function onKey(e: KeyboardEvent<HTMLLIElement>, key: string) {
    if (!e.altKey) return;
    const how = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : e.key === 'Home' ? 'start' : e.key === 'End' ? 'end' : null;
    if (!how) return;
    e.preventDefault();
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act as Btn | undefined;
    move(key, how, act ?? 'up');
  }

  // ---- drag&drop ----
  function clearDrag() { setArmed(null); setDrag(null); setOver(null); }
  function onDragOver(e: DragEvent<HTMLLIElement>, key: string, movable: boolean) {
    if (!drag || !movable) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // автопрокрутка у верхнего/нижнего края окна
    if (e.clientY < 72) window.scrollBy(0, -16);
    else if (e.clientY > window.innerHeight - 72) window.scrollBy(0, 16);
    const side = dropSide(e.clientY, e.currentTarget.getBoundingClientRect());
    const t = dropOrder(rows ?? [], drag, key, side);
    setOver((o) => {
      if (t === null) return o === null ? o : null;
      return o && o.key === key && o.side === side ? o : { key, side };
    });
  }
  function onDrop(e: DragEvent<HTMLLIElement>, key: string, movable: boolean) {
    if (!drag || !movable) return;
    e.preventDefault();
    const side = dropSide(e.clientY, e.currentTarget.getBoundingClientRect());
    const moved = drag;
    const next = dropOrder(rows ?? [], moved, key, side);
    clearDrag();
    if (!next) return;
    onReorder(next);
    const title = rows?.find((r) => r.key === moved)?.entry.title ?? 'Игра';
    setLive(positionText(title, next.indexOf(moved), keys.length));
  }

  const body = (() => {
    if (error && !rows) {
      return (
        <div className="ps-rm-empty" role="alert">
          <Icon name="circle-alert" size={40} />
          <h3 className="ps-h3">Не удалось загрузить очередь</h3>
          <button type="button" className="ps-btn" onClick={onRetry}>Повторить</button>
        </div>
      );
    }
    if (!rows) return <div aria-busy="true" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="ps-skeleton ps-rm-sk-row" />)}</div>;
    if (rows.length === 0) {
      return (
        <div className="ps-rm-empty">
          <StatusGlyph status="backlog" size={40} />
          <h3 className="ps-h3">В бэклоге нет игр</h3>
          <p>Поставь играм статус «Бэклог» в коллекции: они попадут в очередь плана.</p>
          <Link href="/" className="ps-btn ps-btn--primary">К коллекции</Link>
        </div>
      );
    }
    return (
      <ol className="ps-rm-q" ref={listRef} data-dragging={drag ? 'true' : undefined} aria-busy={loading || undefined}>
        {rows.map((r) => {
          const mi = keys.indexOf(r.key);
          const first = mi === 0;
          const last = mi === keys.length - 1;
          const cn = nums.get(r.key) ?? [];
          const e = r.entry;
          const src = hoursSourceLabel(e.hoursSource);
          // Фаза 32 (17.4): hours у начатой игры бэклога = остаток, полная длительность в totalHours
          const started = typeof e.totalHours === 'number' && (e.playedHours ?? 0) > 0 && e.totalHours > e.hours!;
          const isOver = over?.key === r.key ? over.side : undefined;
          return (
            <li
              key={r.key} className="ps-rm-q__item" data-testid="rm-queue-row" data-rm-zone="queue" data-rm-key={r.key} data-state={r.state} data-movable={r.movable || undefined}
              tabIndex={-1} draggable={armed === r.key}
              data-dragging={drag === r.key ? 'true' : undefined} data-drop={isOver}
              onKeyDown={r.movable ? (ev) => onKey(ev, r.key) : undefined}
              onDragStart={(ev) => { if (armed !== r.key) { ev.preventDefault(); return; } ev.dataTransfer.setData('text/plain', r.key); ev.dataTransfer.effectAllowed = 'move'; setDrag(r.key); }}
              onDragOver={(ev) => onDragOver(ev, r.key, r.movable)} onDrop={(ev) => onDrop(ev, r.key, r.movable)} onDragEnd={clearDrag}
            >
              <span
                className="ps-rm-q__handle" aria-hidden="true" data-on={r.movable || undefined}
                onMouseDown={() => r.movable && setArmed(r.key)} onMouseUp={() => setArmed(null)}
              >
                {r.movable && <Icon name="drag-handle" size={16} />}
              </span>
              {r.movable ? (
                <span className="ps-rm-q__n num" aria-label={`Позиция ${positions.get(r.key)}`}>{positions.get(r.key)}</span>
              ) : (
                <span className="ps-rm-q__n ps-rm-q__rel" role="img" aria-label="Релиз" title="Релиз"><Icon name="calendar" size={16} /></span>
              )}
              <Thumb url={e.coverUrl} title={e.title} w={40} h={53} />
              <div className="ps-rm-q__name">
                <b title={e.title}>{r.movable ? <span className="ps-rm-q__pos num">№ {positions.get(r.key)}</span> : null} {e.title}</b>
                <small>
                  {e.hours !== null ? (
                    <>
                      <Icon name="clock" size={12} />
                      {started ? (
                        <span className="num" title={`Наиграно ${hoursLabel(e.playedHours ?? 0)} из ${hoursLabel(e.totalHours ?? 0)}`}>осталось {hoursLabel(e.hours)}</span>
                      ) : <span className="num">{hoursLabel(e.hours)}</span>}
                      {src && <span className="ps-rm-src">{r.movable ? src : 'ручн.'}</span>}
                    </>
                  ) : (
                    <button
                      type="button" className="ps-rm-state" data-tone="warning"
                      onClick={() => {
                        if (r.movable) { onNeedHours(r.key); return; }
                        // релиз: поле часов в карточке блока «Релизы»
                        const card = document.querySelector<HTMLElement>(`[data-rm-zone="releases"][data-rm-key="${r.key}"]`);
                        flashElement(card, card?.querySelector<HTMLElement>('input[type="text"]'));
                      }}
                    ><Icon name="clock" size={12} />{r.movable ? 'Нужны часы' : 'Указать часы'}</button>
                  )}
                  {!r.movable && <span className="ps-rm-tag" title={e.wantAtRelease ? 'Стоит по дате выхода' : 'Без галки: идёт после бэклога, не раньше даты выхода'}><Icon name="calendar" size={12} />Релиз</span>}
                </small>
              </div>
              <PlanCell row={r} conflicts={cn} />
              {r.movable ? (
                <div className="ps-rm-q__act">
                  <button
                    type="button" className="ps-iconbtn ps-rm-sq" data-act="up" aria-label={`Выше: ${e.title}`} aria-disabled={first || undefined}
                    onClick={() => !first && move(r.key, 'up', 'up')}
                  ><Icon name="chevron-up" size={16} /></button>
                  <button
                    type="button" className="ps-iconbtn ps-rm-sq" data-act="down" aria-label={`Ниже: ${e.title}`} aria-disabled={last || undefined}
                    onClick={() => !last && move(r.key, 'down', 'down')}
                  ><Icon name="chevron-down" size={16} /></button>
                  <Popover
                    align="end"
                    trigger={(p) => <button type="button" className="ps-iconbtn ps-rm-sq ps-rm-q__more" data-act="menu" aria-label={`Ещё: ${e.title}`} {...p}><Icon name="more" size={16} /></button>}
                  >
                    {(close) => (
                      <>
                        <button type="button" role="menuitem" className="ps-menu-item" aria-disabled={first || undefined} onClick={() => { close(); if (!first) move(r.key, 'start', 'menu'); }}>
                          <Icon name="arrow-up" size={16} /><span className="ps-menu-item__label">В начало очереди</span>
                        </button>
                        <button type="button" role="menuitem" className="ps-menu-item" aria-disabled={last || undefined} onClick={() => { close(); if (!last) move(r.key, 'end', 'menu'); }}>
                          <Icon name="arrow-down" size={16} /><span className="ps-menu-item__label">В конец очереди</span>
                        </button>
                        {e.gameId !== null && (
                          <Link href={`/?game=${e.gameId}`} scroll={false} role="menuitem" className="ps-menu-item" onClick={() => { markGamePushed(e.gameId as number); close(); }}>
                            <Icon name="external-link" size={16} /><span className="ps-menu-item__label">Открыть игру</span>
                          </Link>
                        )}
                        <button type="button" role="menuitem" className="ps-menu-item ps-menu-item--sep" onClick={() => { close(); onRemove(e); }}>
                          <Icon name="eye-off" size={16} /><span className="ps-menu-item__label">Убрать из плана</span>
                        </button>
                      </>
                    )}
                  </Popover>
                </div>
              ) : (
                <div className="ps-rm-q__act">
                  <Popover
                    align="end"
                    trigger={(p) => <button type="button" className="ps-iconbtn ps-rm-sq ps-rm-q__more" data-act="menu" aria-label={`Ещё: ${e.title}`} {...p}><Icon name="more" size={16} /></button>}
                  >
                    {(close) => (
                      <>
                        <button type="button" role="menuitem" className="ps-menu-item" onClick={() => { close(); flashElement(document.querySelector<HTMLElement>(`[data-rm-zone="releases"][data-rm-key="${r.key}"]`)); }}>
                          <Icon name="pencil" size={16} /><span className="ps-menu-item__label">Править</span>
                        </button>
                        <button type="button" role="menuitem" className="ps-menu-item ps-menu-item--sep" onClick={() => { close(); onRemove(e); }}>
                          <Icon name="eye-off" size={16} /><span className="ps-menu-item__label">Убрать из плана</span>
                        </button>
                      </>
                    )}
                  </Popover>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    );
  })();

  return (
    <>
      <div className="ps-rm-head">
        <h2 className="ps-h2 ps-h2--ic"><StatusGlyph status="backlog" size={16} />Очередь бэклога {rows && <small className="num ps-rm-cnt" title="Строк в расписании: игры бэклога и релизы">{rows.length} {plural(rows.length, ['строка', 'строки', 'строк'])}</small>}</h2>
        <span className="ps-rm-save" role="status" data-state={saveState}>
          {saveState === 'saving' && 'Сохраняю…'}
          {saveState === 'saved' && 'Сохранено'}
          {saveState === 'error' && <><Icon name="circle-alert" size={12} />Порядок не сохранён <button type="button" className="ps-link" onClick={onRetrySave}>Повторить</button></>}
        </span>
      </div>
      <p className="ps-rm-sub">Порядок бэклога задаёшь ты; релизы с галкой стоят по дате выхода и двигаться не могут.</p>
      <p className="ps-sr" aria-live="polite" data-testid="rm-live">{live}</p>
      {body}
    </>
  );
}
