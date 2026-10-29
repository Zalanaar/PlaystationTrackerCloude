'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlannedGameDto, RoadmapEntry, ServiceGame } from '@/server/roadmap/types';
import { Icon } from '../icons';
import { ApiError, fetchUpcoming } from './api';
import { appendUnique, candidateMeta, catalogFail, dayYearText, hoursLabel, upcomingState, type CatalogFailKind, type UpcomingCandidate } from './model';
import { Attribution } from './ReleasesPanel';
import { Spinner, Thumb, useCollapsedList } from './parts';

/** Блок «Не распределено»: игры, убранные из плана. Скрыт, если пусто. */
export function UnallocatedPanel({
  list, onRestore, onDelete,
}: { list: readonly RoadmapEntry[]; onRestore: (e: RoadmapEntry) => Promise<void>; onDelete: (e: RoadmapEntry) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const { shown, toggle } = useCollapsedList(list, 'rm-unallocated', 'rm-un-list');
  if (!list.length) return null;
  async function run(e: RoadmapEntry, fn: (e: RoadmapEntry) => Promise<void>) {
    setBusy(e.key);
    try { await fn(e); } catch { /* тост в родителе */ } finally { setBusy(null); setConfirm(null); }
  }
  return (
    <>
      <div className="ps-rm-head">
        <h2 className="ps-h2 ps-h2--ic"><Icon name="eye-off" size={16} />Не распределено <small className="num ps-rm-cnt">{list.length}</small></h2>
      </div>
      <p className="ps-rm-sub">Эти игры убраны из плана и не занимают недели. Игра из бэклога после возврата встаёт в конец очереди.</p>
      <ul className="ps-rm-un" id="rm-un-list">
        {shown.map((e) => (
          <li key={e.key} id={e.gameId !== null ? `rm-g-${e.gameId}` : undefined} className="ps-rm-un__item" data-testid="rm-unallocated" data-rm-key={e.key}>
            <Thumb url={e.coverUrl} title={e.title} w={36} h={48} />
            <div className="ps-rm-un__name">
              <b title={e.title}>{e.title}</b>
              <small>
                {e.hours !== null ? <span className="num">{hoursLabel(e.hours)}</span> : <span>нет часов</span>}
                {e.releaseDate && <span className="num"> · {dayYearText(e.releaseDate)}</span>}
              </small>
            </div>
            <div className="ps-rm-un__act">
              <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" disabled={busy === e.key} onClick={() => void run(e, onRestore)}>
                {busy === e.key ? <Spinner size={12} /> : <Icon name="undo" size={14} />}Вернуть в план
              </button>
              {e.plannedId !== null && (
                <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm ps-btn--danger" disabled={busy === e.key} aria-expanded={confirm === e.key} onClick={() => setConfirm(confirm === e.key ? null : e.key)}>
                  <Icon name="trash" size={14} />Удалить совсем
                </button>
              )}
            </div>
            {confirm === e.key && (
              <div className="ps-rm-rel__del" role="alertdialog" aria-label={`Удалить «${e.title}» совсем?`}>
                <p>Удалить «{e.title}» совсем? Вернуть будет нельзя.</p>
                <div>
                  <button type="button" className="ps-btn ps-btn--danger" disabled={busy === e.key} onClick={() => void run(e, onDelete)}>Удалить</button>
                  <button type="button" className="ps-btn ps-btn--ghost" autoFocus onClick={() => setConfirm(null)}>Отмена</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {toggle}
    </>
  );
}

/** Таблица «Игры-сервисы: в план не берём»: только справка, без добавления в план. Скрыта, если пусто. */
export function ServicePanel({ list }: { list: readonly ServiceGame[] }) {
  const { shown, toggle } = useCollapsedList(list.map((g) => ({ ...g, gameId: g.gameId as number | null })), 'rm-services', 'rm-svc-body');
  if (!list.length) return null;
  return (
    <>
      <div className="ps-rm-head">
        <h2 className="ps-h2">Игры-сервисы: в план не берём <small className="num ps-rm-cnt">{list.length}</small></h2>
      </div>
      <p className="ps-rm-sub">Игры со статусом «Сервис» не попадают в очередь и не занимают недели плана. Здесь только справка: сколько часов в них уже сыграно.</p>
      <table className="ps-rm-svc" data-testid="rm-services" id="rm-svc-body">
        <thead><tr><th scope="col">Игра</th><th scope="col" className="ps-rm-svc__h">Сыграно</th></tr></thead>
        <tbody>
          {shown.map((g) => (
            <tr key={g.gameId} id={`rm-g-${g.gameId}`}>
              <td><span className="ps-rm-svc__g"><Thumb url={g.coverUrl} title={g.title} w={28} h={37} /><span title={g.title}>{g.title}</span></span></td>
              <td className="ps-rm-svc__h num">{hoursLabel(g.playedHours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {toggle}
    </>
  );
}

type Load = { state: 'loading' } | { state: 'ok' } | { state: 'fail'; kind: CatalogFailKind; text: string };

/**
 * Предстоящие релизы сразу, без поиска (контракт 17.13). «В план» меняет только состояние строки: список не перезагружается.
 * Состояние строки сверяется с актуальными списками релизов и «Не распределено».
 */
export function UpcomingPanel({
  allPlanned, onAdd, onRestore,
}: {
  allPlanned: PlannedGameDto[] | null;
  onAdd: (c: UpcomingCandidate) => Promise<PlannedGameDto>; onRestore: (plannedId: number) => Promise<void>;
}) {
  const [items, setItems] = useState<UpcomingCandidate[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<Record<string, string>>({});
  const [live, setLive] = useState('');
  const reqRef = useRef(0);

  const fetchPage = useCallback(async (n: number) => {
    const my = ++reqRef.current;
    try {
      const r = await fetchUpcoming(n);
      if (my !== reqRef.current) return;
      setItems((l) => (n === 1 ? r.candidates : appendUnique(l, r.candidates)));
      setPage(r.page);
      setHasMore(r.hasMore);
      setLoad({ state: 'ok' });
    } catch (e) {
      if (my !== reqRef.current) return;
      setLoad({ state: 'fail', ...catalogFail(e instanceof ApiError ? e.reason : undefined) });
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void fetchPage(1), 0);
    return () => clearTimeout(t);
  }, [fetchPage]);


  async function add(c: UpcomingCandidate) {
    setBusy(c.externalId);
    setRowErr(({ [c.externalId]: _x, ...r }) => r); // eslint-disable-line @typescript-eslint/no-unused-vars
    try {
      const g = await onAdd(c);
      setItems((l) => l.map((x) => (x.externalId === c.externalId ? { ...x, planned: true, unallocated: false, plannedId: g.id } : x)));
      setLive(`В плане: ${c.title}`);
    } catch (e) {
      const dup = e instanceof ApiError && e.code === 'planned_duplicate';
      if (dup) setItems((l) => l.map((x) => (x.externalId === c.externalId ? { ...x, planned: true } : x)));
      else setRowErr((r) => ({ ...r, [c.externalId]: 'Не удалось добавить. Повтори' }));
    } finally {
      setBusy(null);
    }
  }
  async function restore(c: UpcomingCandidate) {
    const id = upcomingState(c, allPlanned).plannedId;
    if (id === null) return;
    setBusy(c.externalId);
    try {
      await onRestore(id);
      setItems((l) => l.map((x) => (x.externalId === c.externalId ? { ...x, planned: true, unallocated: false } : x)));
      setLive(`В плане: ${c.title}`);
    } catch {
      setRowErr((r) => ({ ...r, [c.externalId]: 'Не удалось вернуть. Повтори' }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="ps-rm-head">
        <h2 className="ps-h2">Предстоящие релизы</h2>
      </div>
      <p className="ps-rm-sub">Игры для PlayStation, которые выходят в ближайший год. «В план» ставит игру на дату выхода (галка «Хочу пройти на релизе»), часы потом введи вручную.</p>
      <p className="ps-sr" aria-live="polite">{live}</p>
      {load.state === 'loading' ? (
        <div aria-busy="true" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i} className="ps-skeleton ps-rm-cand--sk" />)}</div>
      ) : load.state === 'fail' && items.length === 0 ? (
        load.kind === 'not_configured' ? (
          <p className="ps-rm-muted ps-rm-muted--ic" data-testid="rm-upcoming-fail"><Icon name="info" size={12} />Список новинок не настроен. Добавь игру вручную или найди по названию.</p>
        ) : (
          <div className="ps-rm-warn" role="status" data-testid="rm-upcoming-fail">
            <Icon name="alert" size={16} />
            <p>{load.kind === 'rate_limited' ? 'Лимит запросов к каталогу исчерпан. Попробуй позже, найди игру по названию или добавь вручную.' : 'Каталог сейчас недоступен. Найди игру по названию или добавь вручную.'}</p>
            <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => { setLoad({ state: 'loading' }); void fetchPage(1); }}>Повторить</button>
          </div>
        )
      ) : items.length === 0 ? (
        <p className="ps-rm-muted ps-rm-muted--ic">В каталоге пока нет предстоящих релизов.</p>
      ) : (
        <>
          <ul className="ps-rm-upc" data-testid="rm-upcoming" aria-label="Предстоящие релизы">
            {items.map((c) => {
              const { state: st } = upcomingState(c, allPlanned);
              return (
                <li key={c.externalId} className="ps-rm-upc__item" data-testid="rm-upcoming-row" data-state={st}>
                  <Thumb url={c.coverUrl} title={c.title} w={40} h={54} />
                  <span className="ps-rm-cand__tx"><b title={c.title}>{c.title}</b><small>{candidateMeta(c)}</small>
                    {rowErr[c.externalId] && <small className="ps-rm-upc__err"><Icon name="circle-alert" size={12} />{rowErr[c.externalId]}</small>}
                  </span>
                  <span className="ps-rm-upc__act">
                    {st === 'planned' ? (
                      <span className="ps-rm-tag"><Icon name="check" size={12} />В плане</span>
                    ) : st === 'unallocated' ? (
                      <>
                        <span className="ps-rm-tag">Не распределено</span>
                        <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" disabled={busy === c.externalId} onClick={() => void restore(c)}>Вернуть в план</button>
                      </>
                    ) : (
                      <button type="button" className="ps-btn ps-btn--sm" aria-label={`В план: ${c.title}`} disabled={busy === c.externalId} onClick={() => void add(c)}>
                        {busy === c.externalId ? <Spinner size={12} /> : <Icon name="plus" size={14} />}В план
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {load.state === 'fail' && <p className="ps-rm-muted ps-rm-muted--ic" role="status">Не удалось загрузить следующую страницу.</p>}
          {(hasMore || load.state === 'fail') && (
            <div className="ps-rm-upc__more">
              <button
                type="button" className="ps-btn" disabled={more}
                onClick={() => { setMore(true); setLoad({ state: 'ok' }); void fetchPage(page + 1).finally(() => setMore(false)); }}
              >{more ? 'Загрузка…' : 'Показать ещё'}</button>
            </div>
          )}
        </>
      )}
      <Attribution />
    </>
  );
}
