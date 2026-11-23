'use client';
// Идея 5: «Чистка бэклога». По одной игре: «Оставить», «Отложить», «Бросить» (свайп вправо — оставить, влево — отложить),
// «Вернуть» отменяет последнее решение с прежней датой. В конце — итог «−N ч из бэклога».
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { GameItem } from '@/server/collection/types';
import { EmptyState } from '../EmptyState';
import { errorText, fetchBacklogAge, fetchGames, putStatus } from '../collection/api';
import { ageText } from '../collection/backlogAge';
import { Cover, LARGE_W } from '../collection/Cover';
import { COVER_PRELOAD_AHEAD, useCoverPreload } from '../collection/coverPreload';
import { formatHoursApprox, formatPlayTime } from '../format';
import { useToast } from '../primitives/Toast';
import { requestDataRefresh } from '../shell/refresh';
import { cleanupQueue, cleanupTotals, freedHours, freedText, swipeChoice, totalsText, type CleanupChoice, type CleanupItem, type Decision } from './model';

const PAGE = 300;

async function loadBacklog(): Promise<GameItem[]> {
  const out: GameItem[] = [];
  for (let offset = 0; offset < 3000; offset += PAGE) {
    const r = await fetchGames(new URLSearchParams({ status: 'backlog', limit: String(PAGE), offset: String(offset), sort: 'title' }));
    out.push(...r.items);
    if (out.length >= r.total || r.items.length < PAGE) break;
  }
  return out;
}

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; queue: CleanupItem[] };

const LABEL: Record<CleanupChoice, string> = { keep: 'Оставить', shelved: 'Отложить', dropped: 'Бросить' };

export function CleanupView({ chrome }: { chrome?: ReactNode } = {}) {
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [pos, setPos] = useState(0);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [busy, setBusy] = useState(false);
  const [dx, setDx] = useState(0);
  const [exiting, setExiting] = useState<{ item: CleanupItem; dir: CleanupChoice } | null>(null);
  const drag = useRef<{ x: number; id: number } | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);

  const fetchAll = useCallback(() => Promise.all([fetchBacklogAge(), loadBacklog()]).then(
    ([age, games]) => { setLoad({ kind: 'ok', queue: cleanupQueue(age, games, Date.now()) }); setPos(0); setDecisions([]); },
    () => setLoad({ kind: 'error' }),
  ), []);
  useEffect(() => { void fetchAll(); }, [fetchAll]);
  const start = () => { setLoad({ kind: 'loading' }); void fetchAll(); };

  const queue = load.kind === 'ok' ? load.queue : [];
  const cur = queue[pos] ?? null;
  const next = queue[pos + 1] ?? null;
  const finished = load.kind === 'ok' && pos >= queue.length;
  useCoverPreload(queue.slice(pos + 1, pos + 1 + COVER_PRELOAD_AHEAD).map((i) => i.game.coverUrl), LARGE_W);

  useEffect(() => { if (finished && decisions.length) requestDataRefresh('change'); }, [finished, decisions.length]);

  async function decide(choice: CleanupChoice) {
    if (!cur || busy) return;
    const item = cur;
    if (choice !== 'keep') {
      setBusy(true);
      try {
        await putStatus(item.game.id, choice, { expectedStatus: 'backlog' });
      } catch (e) {
        setBusy(false);
        setDx(0);
        toast({ kind: 'error', text: `Не удалось сменить статус. ${errorText(e)}` });
        return;
      }
      setBusy(false);
    }
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) {
      setExiting({ item, dir: choice });
      window.setTimeout(() => setExiting((e) => (e && e.item.game.id === item.game.id ? null : e)), 280);
    }
    setDx(0);
    setDecisions((d) => [...d, { gameId: item.game.id, choice, hours: freedHours(item.game) }]);
    setPos((p) => p + 1);
    headRef.current?.focus();
  }

  const undoLast = useCallback(async () => {
    const last = decisions.at(-1);
    const item = load.kind === 'ok' ? load.queue[pos - 1] : undefined;
    if (!last || !item || busy) return;
    if (last.choice !== 'keep') {
      setBusy(true);
      try {
        await putStatus(item.game.id, 'backlog', { restore: { status: 'backlog', statusChangedAt: item.since, completedAt: null, droppedAt: null } });
      } catch (e) {
        setBusy(false);
        toast({ kind: 'error', text: `Не удалось вернуть. ${errorText(e)}` });
        return;
      }
      setBusy(false);
    }
    setDecisions((d) => d.slice(0, -1));
    setPos((p) => p - 1);
  }, [busy, decisions, load, pos, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key !== 'z' && e.key !== 'Z' && e.key !== 'я' && e.key !== 'Я' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      void undoLast();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [undoLast]);

  const onDown = (e: RPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' || busy) return;
    drag.current = { x: e.clientX, id: e.pointerId };
  };
  const onMove = (e: RPointerEvent<HTMLElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    setDx(e.clientX - drag.current.x);
  };
  const onUp = (e: RPointerEvent<HTMLElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    const c = swipeChoice(e.clientX - drag.current.x);
    drag.current = null;
    if (c) void decide(c);
    else setDx(0);
  };

  const totals = cleanupTotals(decisions);
  const freed = freedText(totals);

  return (
    <div className="ps-container ps-clean" data-testid="cleanup">
      {chrome}
      <h2 className="ps-sr" ref={headRef} tabIndex={-1}>Чистка</h2>
      <p className="ps-clean__lead">Игры, которые ждут дольше 2 лет и наиграно меньше часа. Оставь, отложи или брось — прогноз бэклога станет честнее.</p>

      {load.kind === 'loading' && <div className="ps-clean__card ps-clean__card--ph" aria-busy="true" aria-label="Загружаю бэклог" />}
      {load.kind === 'error' && (
        <EmptyState icon="circle-alert" role="alert" title="Не удалось загрузить бэклог" text="Проверь связь и попробуй ещё раз.">
          <button type="button" className="ps-btn" onClick={start}>Повторить</button>
        </EmptyState>
      )}
      {load.kind === 'ok' && queue.length === 0 && (
        <EmptyState icon="check-circle" role="status" title="Чистить нечего" text="В бэклоге нет игр старше 2 лет, в которые ты почти не играл.">
          <Link href="/backlog" className="ps-btn">В бэклог</Link>
        </EmptyState>
      )}

      {cur && (
        <>
          <p className="ps-clean__count num" aria-live="polite" data-testid="cleanup-progress">{pos + 1} из {queue.length}</p>
          <div className="ps-clean__stack">
            {next && <CleanupCard key={next.game.id} item={next} />}
            <CleanupCard
              key={cur.game.id}
              item={cur}
              front
              dx={dx}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
              onPointerCancel={() => { drag.current = null; setDx(0); }}
            />
            {exiting && <CleanupCard key={`x${exiting.item.game.id}`} item={exiting.item} ghost={exiting.dir} />}
          </div>
          <div className="ps-clean__acts" role="group" aria-label="Решение по игре">
            <button type="button" className="ps-btn" disabled={busy} onClick={() => void decide('keep')} data-testid="cleanup-keep">{LABEL.keep}</button>
            <button type="button" className="ps-btn" disabled={busy} onClick={() => void decide('shelved')} data-testid="cleanup-shelve">{LABEL.shelved}</button>
            <button type="button" className="ps-btn ps-btn--danger" disabled={busy} onClick={() => void decide('dropped')} data-testid="cleanup-drop">{LABEL.dropped}</button>
          </div>
          <p className="ps-clean__hint">Свайп вправо — оставить, влево — отложить.</p>
        </>
      )}

      {finished && queue.length > 0 && (
        <section className="ps-clean__done" role="status" data-testid="cleanup-done">
          <h2>{freed ?? 'Готово'}</h2>
          <p>{totalsText(totals)}.</p>
          <Link href="/backlog" className="ps-btn ps-btn--primary">В бэклог</Link>
        </section>
      )}

      {decisions.length > 0 && (
        <div className="ps-clean__foot">
          {!finished && freed && <span className="ps-clean__sofar num" data-testid="cleanup-sofar">{freed}</span>}
          <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} onClick={() => void undoLast()} data-testid="cleanup-undo">Отменить последнее</button>
        </div>
      )}
    </div>
  );
}


function CleanupCard({ item, front, ghost, dx = 0, ...handlers }: {
  item: CleanupItem; front?: boolean; ghost?: CleanupChoice; dx?: number;
} & Pick<HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'>) {
  const g = item.game;
  const cls = `ps-clean__card${front ? '' : ghost ? ' ps-clean__ghost' : ' ps-clean__card--next'}`;
  return (
    <article
      className={cls}
      data-testid={front ? 'cleanup-card' : undefined}
      data-game-id={g.id}
      aria-hidden={front ? undefined : true}
      aria-label={front ? g.title : undefined}
      style={front && dx ? { transform: `translate3d(${dx}px, 0, 0) rotate(${dx / 30}deg)`, transition: 'none', willChange: 'transform' } : undefined}
      data-dir={ghost ?? (front && dx >= 40 ? 'keep' : front && dx <= -40 ? 'shelved' : undefined)}
      {...(front ? handlers : {})}
    >
      <Cover key={g.id} url={g.coverUrl} title={g.title} className="ps-clean__cover" w={LARGE_W} priority={!ghost} />
      <div className="ps-clean__info">
        <h2 className="ps-clean__title">{g.title}</h2>
        <p className="ps-clean__meta">
          В бэклоге {ageText(item.days)} · {g.playSeconds > 0 ? `наиграно ${formatPlayTime(g.playSeconds)}` : 'не запускалась'}
          {freedHours(g) > 0 && <> · прохождение ≈ {formatHoursApprox(freedHours(g))}</>}
        </p>
      </div>
    </article>
  );
}
