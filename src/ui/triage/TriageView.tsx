'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { GameItem, GameStatusValue, StatusCounts } from '@/server/collection/types';
import { EmptyState } from '../EmptyState';
import { ApiError, errorText, fetchGames, putStatus } from '../collection/api';
import { Cover } from '../collection/Cover';
import { formatDayMonth, formatPlayTime, launchesText } from '../format';
import { StatusGlyph } from '../icons';
import { useMediaQuery } from '../primitives/hooks';
import { useToast } from '../primitives/Toast';
import { StatusMenu } from '../status';
import { STATUS_META, TRIAGE_KEYS, type StatusKey } from '../tokens';
import {
  applyStatus, initState, keyCommand, progress, rollback, skip, summarize, swipeTarget, SWIPE_STAMP, undo, type SwipeTarget, type TriageState,
} from './triage';

type Order = 'last_played' | 'hours';
const LIMIT = 300;
const STATUS_KEYS = Object.entries(TRIAGE_KEYS) as [string, GameStatusValue][];
/** На мобильном 5 кнопок (§4.9), «Сервис» выбирается через меню статуса. */
const MOBILE_KEYS = STATUS_KEYS.filter(([, s]) => s !== 'service');

function hint(status: GameStatusValue, g: GameItem): string | null {
  if (status !== 'completed' && status !== 'dropped') return null;
  return `дата: ${formatDayMonth(g.lastPlayedAt, true) ?? 'сегодня'}`;
}

export function TriageView() {
  const router = useRouter();
  const toast = useToast();
  const wide = useMediaQuery('(min-width: 1000px)');
  const [order, setOrder] = useState<Order>('last_played');
  const [state, setState] = useState<TriageState | null>(null);
  const [counts, setCounts] = useState<StatusCounts | null>(null);
  const [error, setError] = useState(false);
  const [exiting, setExiting] = useState<{ game: GameItem; dir: SwipeTarget } | null>(null);
  const stateRef = useRef<TriageState | null>(null);
  useEffect(() => { stateRef.current = state; }, [state]);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const reqId = useRef(0);

  const load = useCallback(async (o: Order) => {
    const id = ++reqId.current;
    setError(false);
    try {
      const r = await fetchGames(new URLSearchParams({ status: 'none', sort: o, limit: String(LIMIT), offset: '0' }));
      if (id !== reqId.current) return;
      setState((prev) => initState(prev && prev.history.length ? r.items.filter((g) => !prev.history.some((a) => a.kind === 'status' && a.game.id === g.id)) : r.items));
      setCounts(r.counts);
    } catch (e) {
      if (id !== reqId.current) return;
      if (e instanceof ApiError && e.status === 401) return;
      setError(true);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(order), 0);
    return () => clearTimeout(t);
  }, [order, load]);

  // очередь кончилась, а на сервере ещё есть игры (было больше LIMIT): догружаем
  const queueLen = state?.queue.length ?? 0;
  const noneLeft = counts?.none ?? 0;
  useEffect(() => {
    if (state && queueLen === 0 && noneLeft > 0) {
      const t = setTimeout(() => void load(order), 300);
      return () => clearTimeout(t);
    }
  }, [state, queueLen, noneLeft, order, load]);

  const adjust = (delta: number) => setCounts((c) => (c ? { ...c, none: Math.max(0, c.none + delta) } : c));

  const send = useCallback((game: GameItem, status: GameStatusValue | null, onFail: () => void) => {
    const run = async () => {
      try {
        await putStatus(game.id, status);
      } catch (e) {
        onFail();
        toast({ kind: 'error', text: `Не удалось сменить статус. ${errorText(e)}` });
      }
    };
    chain.current = chain.current.then(run, run); // PUT идут строго по очереди: отмена не обгонит действие
  }, [toast]);

  const animate = (game: GameItem, dir: SwipeTarget) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setExiting({ game, dir });
    setTimeout(() => setExiting((e) => (e && e.game.id === game.id ? null : e)), 360);
  };

  const act = useCallback((status: GameStatusValue) => {
    const s = stateRef.current;
    const head = s?.queue[0];
    if (!s || !head) return;
    animate(head, status);
    setState(applyStatus(s, status));
    adjust(-1);
    send(head, status, () => {
      setState((cur) => (cur ? rollback(cur, head) : cur));
      adjust(1);
    });
  }, [send]);

  const doSkip = useCallback(() => {
    const s = stateRef.current;
    if (!s || s.queue.length < 2) return;
    animate(s.queue[0], 'skip');
    setState(skip(s));
  }, []);

  const doUndo = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    const r = undo(s);
    if (!r.undone) return;
    setState(r.state);
    if (r.undone.kind === 'status') {
      adjust(1);
      const game = r.undone.game;
      send(game, null, () => {
        setState((cur) => (cur ? applyStatus({ ...cur, queue: cur.queue.filter((x) => x.id !== game.id) }, (r.undone as { status: GameStatusValue }).status) : cur));
        adjust(-1);
      });
      toast({ text: 'Действие отменено' });
    }
  }, [send, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return; // удержание клавиши не листает очередь
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const cmd = keyCommand(e.key);
      if (!cmd) return;
      if (cmd.type === 'skip' && el && (el.tagName === 'BUTTON' || el.tagName === 'A')) return; // пробел на кнопке нажимает кнопку
      e.preventDefault();
      if (cmd.type === 'status') act(cmd.status);
      else if (cmd.type === 'skip') doSkip();
      else if (cmd.type === 'undo') doUndo();
      else router.push('/');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [act, doSkip, doUndo, router]);

  // ---------- вывод ----------
  if (error && !state) {
    return (
      <EmptyState icon="circle-alert" role="alert" title="Что-то пошло не так" text="Не удалось загрузить очередь. Попробуй ещё раз.">
        <button type="button" className="ps-btn ps-btn--primary" onClick={() => void load(order)}>Обновить</button>
      </EmptyState>
    );
  }
  if (!state || !counts) return <TriageSkeleton />;

  const head = state.queue[0];
  const p = progress(counts.all, counts.none);

  if (!head && counts.none === 0) {
    const sum = summarize(state.history);
    const entries = Object.entries(sum) as [GameStatusValue, number][];
    return (
      <div className="ps-tri ps-tri--done">
        <EmptyState icon={<StatusGlyph status="completed" size={40} />} title="Всё разобрано" text={entries.length ? undefined : 'У всех игр есть статус.'}>
          {entries.length > 0 && (
            <ul className="ps-tri__sum" aria-label="Итог разбора">
              {entries.map(([s, n]) => (
                <li key={s}><StatusGlyph status={s} size={16} />{STATUS_META[s].label}<b className="num">{n}</b></li>
              ))}
            </ul>
          )}
          {state.history.length > 0 && <button type="button" className="ps-btn" onClick={doUndo}>Отменить последнее</button>}
          <Link href="/" className="ps-btn ps-btn--primary">К коллекции</Link>
        </EmptyState>
      </div>
    );
  }
  if (!head) return <TriageSkeleton />;

  return (
    <div className="ps-tri" data-wide={wide || undefined}>
      <div className="ps-tri__top">
        <span className="ps-tri__pos num" aria-label={`Разобрано ${p.done} из ${p.total}`}>{p.done} / {p.total}</span>
        <div className="ps-pbar" role="progressbar" aria-label="Прогресс разбора" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.fraction * 100)}><i style={{ width: `${p.fraction * 100}%` }} /></div>
        <span className="ps-tri__left num">осталось {p.left}</span>
        <Link href="/" className="ps-btn ps-btn--ghost ps-tri__exit">Выйти <kbd>Esc</kbd></Link>
      </div>
      {wide ? (
        <Desktop game={head} queue={state.queue.slice(1, 6)} order={order} onOrder={setOrder} onAct={act} onSkip={doSkip} onUndo={doUndo} canUndo={state.history.length > 0} exiting={exiting} />
      ) : (
        <Mobile game={head} next={state.queue[1]} onAct={act} onSkip={doSkip} onUndo={doUndo} canUndo={state.history.length > 0} exiting={exiting} />
      )}
    </div>
  );
}

function TriageSkeleton() {
  return (
    <div className="ps-tri" aria-busy="true" aria-label="Загрузка">
      <div className="ps-tri__top"><span className="ps-skeleton ps-sk-line" style={{ width: 120 }} /></div>
      <div className="ps-tri__grid"><div className="ps-skeleton ps-tri__cover" /></div>
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

type Common = { game: GameItem; onAct: (s: GameStatusValue) => void; onSkip: () => void; onUndo: () => void; canUndo: boolean; exiting: { game: GameItem; dir: SwipeTarget } | null };

function Desktop({ game, queue, order, onOrder, onAct, onSkip, onUndo, canUndo, exiting }: Common & { queue: GameItem[]; order: Order; onOrder: (o: Order) => void }) {
  return (
    <div className="ps-tri__grid">
      <div className="ps-tri__coverwrap">
        <Cover key={game.id} url={game.coverUrl} title={game.title} className="ps-tri__cover" />
        {exiting && <Cover key={`x${exiting.game.id}`} url={exiting.game.coverUrl} title={exiting.game.title} className="ps-tri__cover ps-tri__ghost" />}
      </div>
      <div className="ps-tri__center">
        <p className="ps-micro">Не разобрано</p>
        <h2 className="ps-tri__title" title={game.title}>{game.title}</h2>
        <Facts game={game} />
        <div className="ps-keys" role="group" aria-label="Статус игры">
          {STATUS_KEYS.map(([k, s]) => (
            <button key={s} type="button" className="ps-key" data-status={s} onClick={() => onAct(s)} aria-keyshortcuts={k} title={s === 'service' ? 'Игра-сервис: вне хроники и бэклога' : undefined}>
              <kbd>{k}</kbd>
              <StatusGlyph status={s} size={20} />
              <span className="ps-key__l">{STATUS_META[s].label}</span>
              <span className="ps-key__h">{hint(s, game)}</span>
            </button>
          ))}
        </div>
        <p className="ps-tri__note">Дата завершения = последний запуск. Поправить её можно в карточке игры.</p>
        <div className="ps-tri__hints">
          <button type="button" className="ps-link ps-link--plain" onClick={onSkip}><kbd>Пробел</kbd>Пропустить</button>
          <button type="button" className="ps-link ps-link--plain" onClick={onUndo} disabled={!canUndo}><kbd>Z</kbd>Отменить</button>
        </div>
      </div>
      <aside className="ps-queue" aria-label="Дальше">
        <div className="ps-queue__head">
          <p className="ps-micro">Дальше</p>
          <div className="ps-seg" role="group" aria-label="Порядок">
            <button type="button" aria-pressed={order === 'last_played'} onClick={() => onOrder('last_played')}>По запуску</button>
            <button type="button" aria-pressed={order === 'hours'} onClick={() => onOrder('hours')}>По часам</button>
          </div>
        </div>
        <ul>
          {queue.map((g) => (
            <li key={g.id} className="ps-queue__q">
              <Cover url={g.coverUrl} title={g.title} className="ps-queue__th" />
              <span><span className="ps-queue__t">{g.title}</span><span className="ps-queue__m num">{formatPlayTime(g.playSeconds) ?? 'не запускалась'}</span></span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function Mobile({ game, next, onAct, onSkip, onUndo, canUndo, exiting }: Common & { next?: GameItem }) {
  const [drag, setDrag] = useState<{ dx: number; dy: number; w: number } | null>(null);
  const start = useRef<{ x: number; y: number; w: number } | null>(null);
  const time = formatPlayTime(game.playSeconds);

  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, w: e.currentTarget.getBoundingClientRect().width };
    setDrag({ dx: 0, dy: 0, w: start.current.w });
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (s) setDrag({ dx: e.clientX - s.x, dy: e.clientY - s.y, w: s.w });
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    start.current = null;
    setDrag(null);
    if (!s) return;
    const t = swipeTarget(e.clientX - s.x, e.clientY - s.y, s.w);
    if (t === 'skip') onSkip();
    else if (t) onAct(t);
  };
  const cand = drag ? swipeTarget(drag.dx, drag.dy, drag.w, SWIPE_STAMP) : null;
  const style = drag ? { transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx / 20}deg)`, transition: 'none' } : undefined;
  return (
    <div className="ps-tri__m">
      <div className="ps-stack3">
        <div className="ps-stack3__under" />
        <div className="ps-stack3__under ps-stack3__under--2" />
        {next && <span className="ps-sr">Дальше: {next.title}</span>}
        <div
          key={game.id} className="ps-stack3__top" style={style} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { start.current = null; setDrag(null); }}
          aria-label={game.title}
        >
          <Cover url={game.coverUrl} title={game.title} className="ps-stack3__img" />
          <div className="ps-stack3__cap">
            <h2>{game.title}</h2>
            <span className="num">{time ?? 'не запускалась'}{game.playCount > 0 ? ` · ${launchesText(game.playCount)}` : ''}</span>
          </div>
          {cand && cand !== 'skip' && (
            <span className="ps-stamp" data-status={cand}><StatusGlyph status={cand} size={16} />{STATUS_META[cand].label}</span>
          )}
          {cand === 'skip' && <span className="ps-stamp" data-status="none"><StatusGlyph status="none" size={16} />Пропустить</span>}
        </div>
        {exiting && <div className="ps-stack3__top ps-tri__ghost" data-dir={exiting.dir} aria-hidden="true"><Cover url={exiting.game.coverUrl} title={exiting.game.title} className="ps-stack3__img" /></div>}
      </div>
      <p className="ps-tri__edges" aria-hidden="true">
        <span><StatusGlyph status="dropped" size={12} />влево</span>
        <span><StatusGlyph status="backlog" size={12} />вверх</span>
        <span>вниз: пропуск</span>
        <span>вправо<StatusGlyph status="completed" size={12} /></span>
      </p>
      <div className="ps-tri__actions" role="group" aria-label="Статус игры">
        {MOBILE_KEYS.map(([, s]) => (
          <button key={s} type="button" data-status={s} onClick={() => onAct(s)} aria-label={STATUS_META[s as StatusKey].label}>
            <StatusGlyph status={s} size={20} />
            <span>{SHORT[s]}</span>
          </button>
        ))}
      </div>
      <div className="ps-tri__row2">
        <button type="button" className="ps-btn" onClick={onSkip}>Пропустить</button>
        <button type="button" className="ps-btn" onClick={onUndo} disabled={!canUndo}>Отменить</button>
        <StatusMenu
          onPick={(s) => { if (s) onAct(s); }} label="Другой статус" hide={['none']} className="ps-tri__more"
          triggerClassName="ps-btn"
        >
          Статус…
        </StatusMenu>
      </div>
    </div>
  );
}

const SHORT: Record<GameStatusValue, string> = { playing: 'Играю', completed: 'Пройд.', backlog: 'Бэклог', dropped: 'Бросил', shelved: 'Пауза', service: 'Сервис' };
