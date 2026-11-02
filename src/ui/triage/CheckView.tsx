'use client';

import Link from 'next/link';
import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { GameItem, GameStatusValue } from '@/server/collection/types';
import { STATUS_HINT_RULES } from '@/shared/status-hints';
import { EmptyState } from '../EmptyState';
import { Cover, THUMB_SIZES } from '../collection/Cover';
import { formatPlayTime, launchesText, formatDayMonth } from '../format';
import { StatusGlyph } from '../icons';
import { StatusMenu } from '../status';
import { STATUS_META, TRIAGE_KEYS } from '../tokens';
import {
  acceptLabel, checkSwipe, hintAnnounce, hintQuestion, hintReason, isCurrentStatus, isHintTarget, keyDateHint, platinumDateNote, primaryTarget, STALE_LABEL, summarizeHints,
  type CheckSwipe, type HintItem, type HintState,
} from './hints';
import type { CheckQueue } from './useCheckQueue';

const STATUS_KEYS = Object.entries(TRIAGE_KEYS) as [string, GameStatusValue][];
const MOBILE_KEYS = STATUS_KEYS.filter(([, s]) => s !== 'service');
const SHORT: Record<GameStatusValue, string> = { playing: 'Играю', completed: 'Пройд.', backlog: 'Бэклог', dropped: 'Бросил', shelved: 'Пауза', service: 'Сервис' };
/** Известные правила: неизвестное из будущей версии API не рисуем (карточка всё равно доступна кнопками статусов). */
const KNOWN_RULES: readonly string[] = STATUS_HINT_RULES;

type Exiting = { game: GameItem; dir?: 'completed' | 'dropped' } | null;
type Actions = Pick<CheckQueue, 'accept' | 'keep' | 'dismiss' | 'undo'>;

/** Причина по шаблонам §13.2: числа и даты жирным. */
function Reason({ h }: { h: HintItem }) {
  return (
    <p className="ps-sg__why">
      {hintReason(h).map((s, i) => (s.bold ? <b key={i} className="num">{s.text}</b> : <span key={i}>{s.text}</span>))}
    </p>
  );
}

function Block({ h }: { h: HintItem }) {
  const target = primaryTarget(h);
  return (
    <div className="ps-sg" role="group" aria-label="Подсказка" data-status={target} data-rule={h.rule}>
      <span className="ps-sg__rule"><StatusGlyph status={target} size={12} />Подсказка</span>
      <h3 className="ps-sg__q">{hintQuestion(h.rule)}</h3>
      <Reason h={h} />
      <p className="ps-sg__warn">Статус не изменится, пока ты не выберешь.</p>
    </div>
  );
}

function Facts({ game }: { game: GameItem }) {
  const time = formatPlayTime(game.playSeconds);
  const t = game.trophies;
  return (
    <p className="ps-tri__facts">
      {time ? <span><b className="num">{time}</b> наиграно</span> : <span>не запускалась</span>}
      {game.playCount > 0 && <span><b className="num">{game.playCount}</b> {launchesText(game.playCount).split(' ')[1]}</span>}
      {t && <span>трофеи <b className="num">{t.earned}/{t.defined}</b></span>}
      {game.lastPlayedAt && <span>последний запуск <b className="num">{formatDayMonth(game.lastPlayedAt, true)}</b></span>}
    </p>
  );
}

/** Кнопки «Принять»: у stale две цели (основная primary). */
function AcceptButtons({ h, onAccept }: { h: HintItem; onAccept: (s: GameStatusValue) => void }) {
  const targets = h.suggested;
  if (targets.length > 1) {
    return (
      <>
        {targets.map((s, i) => (
          <button key={s} type="button" className={`ps-btn ${i === 0 ? 'ps-btn--primary' : ''} ps-sg__btn`} data-status={s} onClick={() => onAccept(s)} aria-keyshortcuts={i === 0 ? `Enter ${TRIAGE_KEYS_REV[s]}` : TRIAGE_KEYS_REV[s]}>
            <StatusGlyph status={s} size={16} />{STALE_LABEL[s] ?? STATUS_META[s].label}
          </button>
        ))}
      </>
    );
  }
  const s = primaryTarget(h);
  const note = platinumDateNote(h);
  return (
    <button type="button" className="ps-btn ps-btn--primary ps-sg__btn ps-sg__btn--main" data-status={s} data-sub={note ? '' : undefined} onClick={() => onAccept(s)} aria-keyshortcuts={`Enter ${TRIAGE_KEYS_REV[s]}`}>
      <StatusGlyph status={s} size={16} />
      {note ? <span className="ps-sg__lbl">{acceptLabel(s)}<small>{note}</small></span> : acceptLabel(s)}
    </button>
  );
}
const TRIAGE_KEYS_REV = Object.fromEntries(STATUS_KEYS.map(([k, s]) => [s, k])) as Record<GameStatusValue, string>;

export function CheckBody({ state, wide, a, hasUnsorted, onToUnsorted }: {
  state: HintState; wide: boolean; a: Actions; hasUnsorted: boolean; onToUnsorted: () => void;
}) {
  const [exiting, setExiting] = useState<Exiting>(null);
  const head = state.queue[0];
  const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animate = (game: GameItem, dir?: 'completed' | 'dropped') => {
    if (reduced()) return;
    setExiting({ game, dir });
    setTimeout(() => setExiting((e) => (e && e.game.id === game.id ? null : e)), 360);
  };
  const act: Actions = {
    accept: (s) => { if (head && !isCurrentStatus(head, s)) { animate(head.game, 'completed'); a.accept(s); } },
    keep: () => { if (head) { animate(head.game, 'dropped'); a.keep(); } },
    dismiss: () => { if (head) { animate(head.game); a.dismiss(); } },
    undo: a.undo,
  };

  if (state.total === 0) {
    return (
      <div className="ps-tri ps-tri--done">
        <EmptyState icon="check-circle" title="Подсказок нет" text="Статусы совпадают с тем, во что ты играешь. Новые подсказки появятся после ночного синка.">
          {hasUnsorted && <button type="button" className="ps-btn ps-btn--ghost" onClick={onToUnsorted}>К разбору</button>}
          <Link href="/" className="ps-link">К коллекции</Link>
        </EmptyState>
      </div>
    );
  }
  if (!head) {
    const sum = summarizeHints(state.history);
    return (
      <div className="ps-tri ps-tri--done">
        <EmptyState icon={<StatusGlyph status="completed" size={40} />} title="Всё проверено">
          <ul className="ps-tri__sum" aria-label="Итог проверки">
            <li>Принято <b className="num">{sum.accepted}</b></li>
            <li>Оставлено <b className="num">{sum.kept}</b></li>
            <li>Не предлагать <b className="num">{sum.dismissed}</b></li>
          </ul>
          {state.history.length > 0 && <button type="button" className="ps-btn" onClick={a.undo}>Отменить последнее</button>}
          <Link href="/" className="ps-btn ps-btn--primary">К коллекции</Link>
        </EmptyState>
      </div>
    );
  }
  const pos = Math.min(state.history.length + 1, state.total);
  const live = <p className="ps-sr" aria-live="polite">{KNOWN_RULES.includes(head.rule) ? hintAnnounce(pos, state.total, head) : head.game.title}</p>;
  return wide
    ? <>{live}<CheckDesktop h={head} queue={state.queue.slice(1, 6)} a={act} canUndo={state.history.length > 0} exiting={exiting} /></>
    : <>{live}<CheckMobile h={head} next={state.queue[1]?.game} a={act} canUndo={state.history.length > 0} exiting={exiting} /></>;
}

function CheckDesktop({ h, queue, a, canUndo, exiting }: { h: HintItem; queue: HintItem[]; a: Actions; canUndo: boolean; exiting: Exiting }) {
  const game = h.game;
  return (
    <div className="ps-tri__grid">
      <div className="ps-tri__coverwrap">
        <Cover key={game.id} url={game.coverUrl} title={game.title} className="ps-tri__cover" />
        {exiting && <Cover key={`x${exiting.game.id}`} url={exiting.game.coverUrl} title={exiting.game.title} className="ps-tri__cover ps-tri__ghost" />}
      </div>
      <div className="ps-tri__center">
        <h2 className="ps-tri__title" title={game.title}>{game.title}</h2>
        <Facts game={game} />
        <Block h={h} />
        <div className="ps-sg__act" data-status={primaryTarget(h)}>
          <AcceptButtons h={h} onAccept={a.accept} />
          <button type="button" className="ps-btn ps-sg__btn" onClick={a.keep} aria-keyshortcuts="0"><kbd>0</kbd>Оставить как есть</button>
        </div>
        <div className="ps-keys" data-tour="triage-actions" role="group" aria-label="Статус игры">
          {STATUS_KEYS.map(([k, s]) => {
            const current = isCurrentStatus(h, s);
            const target = isHintTarget(h, s);
            return (
              <button
                key={s} type="button" className="ps-key" data-status={s} data-target={target || undefined} aria-disabled={current || undefined}
                onClick={() => { if (!current) a.accept(s); }} aria-keyshortcuts={k} title={s === 'service' ? 'Игра-сервис: вне хроники и бэклога' : undefined}
              >
                <kbd>{k}</kbd>
                <StatusGlyph status={s} size={20} />
                <span className="ps-key__l">{STATUS_META[s].label}</span>
                <span className="ps-key__h">{current ? 'сейчас' : target ? 'предлагаем' : keyDateHint(h, s)}</span>
              </button>
            );
          })}
        </div>
        <p className="ps-tri__note">Дата завершения = последний запуск. Поправить её можно в карточке игры.</p>
        <div className="ps-tri__hints">
          <button type="button" className="ps-link ps-link--plain" onClick={a.dismiss} aria-keyshortcuts="N" title="Это правило больше не будет предлагаться для этой игры"><kbd>N</kbd>Не предлагать</button>
          <button type="button" className="ps-link ps-link--plain" onClick={a.undo} disabled={!canUndo} aria-keyshortcuts="Z"><kbd>Z</kbd>Отменить</button>
        </div>
      </div>
      <aside className="ps-queue" aria-label="Дальше">
        <div className="ps-queue__head"><p className="ps-micro">Дальше</p></div>
        <ul>
          {queue.map((q) => (
            <li key={q.gameId} className="ps-queue__q">
              <span className="ps-queue__thw">
                <Cover url={q.game.coverUrl} title={q.game.title} className="ps-queue__th" sizes={THUMB_SIZES} />
                <span className="ps-queue__dot" title={hintQuestion(q.rule)} role="img" aria-label={hintQuestion(q.rule)}><StatusGlyph status={primaryTarget(q)} size={9} /></span>
              </span>
              <span><span className="ps-queue__t">{q.game.title}</span><span className="ps-queue__m">{hintQuestion(q.rule)}</span></span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function CheckMobile({ h, next, a, canUndo, exiting }: { h: HintItem; next?: GameItem; a: Actions; canUndo: boolean; exiting: Exiting }) {
  const game = h.game;
  const [drag, setDrag] = useState<{ dx: number; w: number } | null>(null);
  const start = useRef<{ x: number; y: number; w: number } | null>(null);
  const time = formatPlayTime(game.playSeconds);
  const target = primaryTarget(h);
  const stale = h.suggested.length > 1;

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, w: e.currentTarget.getBoundingClientRect().width };
    setDrag({ dx: 0, w: start.current.w });
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (s) setDrag({ dx: e.clientX - s.x, w: s.w }); // вертикаль не следует за пальцем: вверх и вниз отключены
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    start.current = null;
    setDrag(null);
    if (!s) return;
    const t = checkSwipe(e.clientX - s.x, e.clientY - s.y, s.w);
    if (t === 'accept') a.accept(target);
    else if (t === 'keep') a.keep();
  };
  const cand: CheckSwipe | null = drag ? checkSwipe(drag.dx, 0, drag.w, 0.12) : null;
  const style = drag ? { transform: `translateX(${drag.dx}px) rotate(${drag.dx / 20}deg)`, transition: 'none' } : undefined;
  return (
    <div className="ps-tri__m">
      <div className="ps-stack3">
        <div className="ps-stack3__under" />
        <div className="ps-stack3__under ps-stack3__under--2" />
        {next && <span className="ps-sr">Дальше: {next.title}</span>}
        <div
          key={game.id} className="ps-stack3__top" style={style} onPointerDown={down} onPointerMove={move} onPointerUp={up}
          onPointerCancel={() => { start.current = null; setDrag(null); }} aria-label={game.title}
        >
          <Cover url={game.coverUrl} title={game.title} className="ps-stack3__img" />
          <span className="ps-stack3__fg"><StatusGlyph status={target} size={12} />{hintQuestion(h.rule)}</span>
          <div className="ps-stack3__cap">
            <h2>{game.title}</h2>
            <span className="num">{time ?? 'не запускалась'}{game.playCount > 0 ? ` · ${launchesText(game.playCount)}` : ''}</span>
          </div>
          {cand === 'accept' && <span className="ps-stamp" data-status={target}><StatusGlyph status={target} size={16} />Принять</span>}
          {cand === 'keep' && <span className="ps-stamp" data-status="none"><StatusGlyph status="none" size={16} />Оставить</span>}
        </div>
        {exiting && <div className="ps-stack3__top ps-tri__ghost" data-dir={exiting.dir} aria-hidden="true"><Cover url={exiting.game.coverUrl} title={exiting.game.title} className="ps-stack3__img" /></div>}
      </div>
      <Block h={h} />
      <div className="ps-tri__row2 ps-sg__row">
        <AcceptButtons h={h} onAccept={a.accept} />
        {!stale && <button type="button" className="ps-btn" onClick={a.keep}>Оставить</button>}
      </div>
      {stale && <div className="ps-tri__row2"><button type="button" className="ps-btn" onClick={a.keep}>Оставить как есть</button></div>}
      <div className="ps-tri__actions" data-tour="triage-buttons" role="group" aria-label="Другой статус">
        {MOBILE_KEYS.map(([, s]) => {
          const current = isCurrentStatus(h, s);
          return (
            <button key={s} type="button" data-status={s} data-target={isHintTarget(h, s) || undefined} disabled={current} onClick={() => a.accept(s)} aria-label={STATUS_META[s].label}>
              <StatusGlyph status={s} size={20} />
              <span>{SHORT[s]}</span>
            </button>
          );
        })}
      </div>
      <div className="ps-tri__row2">
        <button type="button" className="ps-btn" onClick={a.undo} disabled={!canUndo}>Отменить</button>
        <StatusMenu onPick={(s) => { if (s && !isCurrentStatus(h, s)) a.accept(s); }} label="Другой статус" hide={['none']} className="ps-tri__more" triggerClassName="ps-btn">Статус…</StatusMenu>
      </div>
      <div className="ps-tri__row2">
        <button type="button" className="ps-btn ps-btn--ghost ps-sg__dismiss" onClick={a.dismiss} title="Это правило больше не будет предлагаться для этой игры">Не предлагать для этой игры</button>
      </div>
    </div>
  );
}
