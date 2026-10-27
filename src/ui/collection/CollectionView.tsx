'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CollectionSummaryResponse, GameItem, GameStatusValue, GamesListResponse } from '@/server/collection/types';
import { EmptyState } from '../EmptyState';
import { formatNumber } from '../format';
import { Icon } from '../icons';
import { useNow } from '../primitives/hooks';
import { useToast } from '../primitives/Toast';
import { StatusMenu } from '../status';
import { useSync } from '../sync/SyncProvider';
import { buttonLabel, phaseText, progressFraction } from '../sync/status';
import { STATUS_META } from '../tokens';
import { ApiError, errorText, fetchGames, fetchSummary, patchStatusDate, postBulk, putStatus } from './api';
import {
  adjustCounts, applyStatusLocally, filtersToApi, filtersToUrl, hasActiveFilters, parseFilters, resetFilters, type Filters,
} from './filters';
import { GameCard, type GameActions } from './GameCard';
import { GameDialog } from './GameDialog';
import { GameRow, RowHeader } from './GameRow';
import { FilterBar } from './FilterBar';
import { ContinueRow, NowPlaying, StatsHeader } from './Overview';

const PAGE = 60;
const BULK_MAX = 250;

type ListState = Pick<GamesListResponse, 'items' | 'total' | 'counts' | 'years'>;

export function CollectionView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const filtersKey = filtersToUrl(filters).toString() + '|' + filters.status;
  const toast = useToast();
  const now = useNow();
  const sync = useSync();

  const [summary, setSummary] = useState<CollectionSummaryResponse | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [list, setList] = useState<ListState | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [more, setMore] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<{ id: number; edit: boolean; snapshot: GameItem } | null>(null);

  const listRef = useRef<ListState | null>(null);
  useEffect(() => { listRef.current = list; }, [list]);
  const reqId = useRef(0);
  const undoRef = useRef<((g: GameItem, s: GameStatusValue | null, silent?: boolean) => Promise<void>) | null>(null);

  // ---------- загрузка ----------
  const loadSummary = useCallback(async () => {
    try {
      setSummary(await fetchSummary());
      setSummaryError(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      setSummaryError(true);
    }
  }, []);

  const loadList = useCallback(async (f: Filters, limit: number) => {
    const id = ++reqId.current;
    setListLoading(true);
    try {
      const r = await fetchGames(filtersToApi(f, { limit, offset: 0 }));
      if (id !== reqId.current) return;
      setList({ items: r.items, total: r.total, counts: r.counts, years: r.years });
      setListError(false);
    } catch {
      if (id !== reqId.current) return;
      setListError(true);
    } finally {
      if (id === reqId.current) setListLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadSummary(), 0);
    return () => clearTimeout(t);
  }, [loadSummary]);

  useEffect(() => {
    const t = setTimeout(() => void loadList(filters, PAGE), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перезагрузка только при смене фильтров
  }, [filtersKey, loadList]);

  const refresh = useCallback(() => {
    void loadSummary();
    void loadList(filters, Math.max(PAGE, listRef.current?.items.length ?? 0));
  }, [filters, loadList, loadSummary]);

  // после завершения синка перечитываем данные
  const lastSuccess = sync.status?.lastSuccessAt ?? null;
  const seenSuccess = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (seenSuccess.current === undefined) {
      seenSuccess.current = lastSuccess;
      return;
    }
    if (seenSuccess.current !== lastSuccess) {
      seenSuccess.current = lastSuccess;
      const t = setTimeout(refresh, 0);
      return () => clearTimeout(t);
    }
  }, [lastSuccess, refresh]);

  async function loadMore() {
    if (!list) return;
    setMore(true);
    try {
      const r = await fetchGames(filtersToApi(filters, { limit: PAGE, offset: list.items.length }));
      setList((l) => {
        if (!l) return l;
        const have = new Set(l.items.map((g) => g.id));
        return { ...l, ...{ total: r.total, counts: r.counts, years: r.years }, items: [...l.items, ...r.items.filter((g) => !have.has(g.id))] };
      });
    } catch (e) {
      toast({ kind: 'error', text: `Не удалось загрузить ещё. ${errorText(e)}` });
    } finally {
      setMore(false);
    }
  }

  // ---------- URL ----------
  const setFilters = useCallback((p: Partial<Filters>) => {
    const next = { ...filters, ...p };
    const qs = filtersToUrl(next).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [filters, pathname, router]);

  // ---------- локальное состояние игр ----------
  const replaceGames = useCallback((games: GameItem[]) => {
    const by = new Map(games.map((g) => [g.id, g]));
    const swap = (arr: GameItem[]) => arr.map((g) => by.get(g.id) ?? g);
    setList((l) => (l ? { ...l, items: swap(l.items) } : l));
    setSummary((s) => (s ? { ...s, playing: swap(s.playing), continue: swap(s.continue) } : s));
    setOpen((o) => (o && by.get(o.id) ? { ...o, snapshot: by.get(o.id) as GameItem } : o));
  }, []);

  const shiftCounts = useCallback((from: GameStatusValue | null, to: GameStatusValue | null) => {
    setList((l) => (l ? { ...l, counts: adjustCounts(l.counts, from, to) } : l));
    setSummary((s) => (s ? { ...s, counts: adjustCounts(s.counts, from, to) } : s));
  }, []);

  const current = useCallback((g: GameItem): GameItem => {
    return listRef.current?.items.find((x) => x.id === g.id) ?? g;
  }, []);

  const setStatus = useCallback(async (game: GameItem, status: GameStatusValue | null, silent = false) => {
    const prev = current(game);
    if (prev.status === status) return;
    replaceGames([applyStatusLocally(prev, status, new Date().toISOString())]);
    shiftCounts(prev.status, status);
    try {
      const r = await putStatus(prev.id, status);
      replaceGames([r.game]);
      toast({
        text: silent ? 'Статус возвращён' : `Статус изменён: ${STATUS_META[status ?? 'none'].label}`,
        action: silent ? undefined : { label: 'Отменить', run: () => void undoRef.current?.(r.game, prev.status, true) },
      });
      refresh();
    } catch (e) {
      replaceGames([prev]);
      shiftCounts(status, prev.status);
      toast({ kind: 'error', text: `Не удалось сменить статус. ${errorText(e)}` });
    }
  }, [current, refresh, replaceGames, shiftCounts, toast]);

  useEffect(() => { undoRef.current = setStatus; }, [setStatus]);

  const setDate = useCallback(async (game: GameItem, kind: 'completed' | 'dropped', iso: string) => {
    const prev = current(game);
    replaceGames([kind === 'completed' ? { ...prev, completedAt: iso } : { ...prev, droppedAt: iso }]);
    try {
      const r = await patchStatusDate(prev.id, kind, iso);
      replaceGames([r.game]);
      toast({ text: 'Дата завершения сохранена' });
      refresh();
    } catch (e) {
      replaceGames([prev]);
      toast({ kind: 'error', text: `Не удалось сохранить дату. ${errorText(e)}` });
    }
  }, [current, refresh, replaceGames, toast]);

  const bulk = useCallback(async (status: GameStatusValue | null) => {
    const ids = [...selected];
    const prevs = ids.map((id) => listRef.current?.items.find((g) => g.id === id)).filter((g): g is GameItem => !!g);
    if (!ids.length) return;
    const nowIso = new Date().toISOString();
    replaceGames(prevs.map((g) => applyStatusLocally(g, status, nowIso)));
    for (const g of prevs) shiftCounts(g.status, status);
    try {
      let changed = 0;
      for (let i = 0; i < ids.length; i += BULK_MAX) {
        const r = await postBulk(ids.slice(i, i + BULK_MAX), status);
        changed += r.changed;
        replaceGames(r.games);
      }
      toast({ text: `Статус «${STATUS_META[status ?? 'none'].label}»: изменено игр ${changed} из ${ids.length}` });
      setSelected(new Set());
      setSelectMode(false);
      refresh();
    } catch (e) {
      replaceGames(prevs);
      for (const g of prevs) shiftCounts(status, g.status);
      toast({ kind: 'error', text: `Массовая смена не выполнена, ничего не изменено. ${errorText(e)}` });
    }
  }, [refresh, replaceGames, selected, shiftCounts, toast]);

  const actions: GameActions = useMemo(() => ({
    open: (g, edit = false) => setOpen({ id: g.id, edit, snapshot: g }),
    setStatus: (g, s) => void setStatus(g, s),
    toggle: (g) => setSelected((s) => {
      const n = new Set(s);
      if (!n.delete(g.id)) n.add(g.id);
      return n;
    }),
  }), [setStatus]);

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  // ---------- вывод ----------
  const items = list?.items ?? [];
  const active = hasActiveFilters(filters);
  const noData = (summary ? summary.totals.games === 0 : list?.counts.all === 0 && !active) && (list?.total ?? 0) === 0 && !listError;
  const openGame = open ? (items.find((g) => g.id === open.id) ?? summary?.playing.find((g) => g.id === open.id) ?? summary?.continue.find((g) => g.id === open.id) ?? open.snapshot) : null;
  const playing0 = summary?.playing[0];
  const run = sync.status?.run;
  const syncing = !!sync.status?.running;

  return (
    <div className="ps-collection">
      <StatsHeader summary={summary} status={filters.status} onStatus={(s) => setFilters({ status: s })} heroUrl={playing0?.coverUrl ?? null} />

      {summaryError && !summary && (
        <div className="ps-inline-error" role="alert">
          <Icon name="circle-alert" size={18} />
          <span>Не удалось загрузить сводку.</span>
          <button type="button" className="ps-link" onClick={() => void loadSummary()}>Повторить</button>
        </div>
      )}

      {playing0 && <NowPlaying game={playing0} now={now} actions={actions} />}
      {summary && <ContinueRow summary={summary} now={now} actions={actions} />}

      <section className="ps-section" aria-labelledby="coll-title">
        <div className="ps-section__head">
          <h1 id="coll-title" className="ps-h2">Коллекция</h1>
          {list && <span className="ps-count ps-num" aria-label={`Найдено игр: ${list.total}`}>{formatNumber(list.total)}</span>}
          <span className="ps-section__spacer" />
          <div className="ps-seg" role="group" aria-label="Вид">
            <button type="button" aria-pressed={filters.view === 'grid'} aria-label="Сетка" title="Сетка" onClick={() => setFilters({ view: 'grid' })}><Icon name="grid" size={16} /></button>
            <button type="button" aria-pressed={filters.view === 'list'} aria-label="Список" title="Список" onClick={() => setFilters({ view: 'list' })}><Icon name="list" size={16} /></button>
          </div>
          <button type="button" className="ps-btn" aria-pressed={selectMode} onClick={() => (selectMode ? exitSelect() : setSelectMode(true))} disabled={items.length === 0}>
            <Icon name="check-circle" size={16} />{selectMode ? 'Готово' : 'Выбрать'}
          </button>
          <button type="button" className="ps-btn ps-btn--outline ps-desktop-only" onClick={() => void sync.start()} disabled={sync.starting || syncing || sync.loading}>
            <Icon name="refresh" size={16} />{sync.status ? buttonLabel(sync.status, sync.starting) : 'Синк сейчас'}
          </button>
        </div>

        <FilterBarSlot filters={filters} list={list} onChange={setFilters} onReset={() => setFilters(resetFilters(filters))} />

        {filters.year !== null && (
          <p className="ps-hint" role="note">
            <Icon name="info" size={16} />
            <span>Год считается по дате завершения: игры со статусами «Играю», «Бэклог», «Отложено» и без статуса не показываются.</span>
          </p>
        )}

        <div aria-busy={listLoading} className="ps-results" data-loading={(listLoading && !!list) || undefined}>
          {!list && listLoading ? (
            filters.view === 'list' ? <ListSkeleton /> : <GridSkeleton />
          ) : listError && items.length === 0 ? (
            <EmptyState icon="circle-alert" role="alert" title="Что-то пошло не так" text="Не удалось загрузить коллекцию. Сохранённые данные не потеряны.">
              <button type="button" className="ps-btn ps-btn--primary" onClick={() => loadList(filters, PAGE)}>Обновить</button>
            </EmptyState>
          ) : noData ? (
            <EmptyState icon="cloud-download" title="Пока пусто" text="Данные из PSN ещё не загружены. Запусти первый синк, он займёт несколько минут.">
              {syncing && run ? (
                <SyncProgress />
              ) : (
                <button type="button" className="ps-btn ps-btn--primary" onClick={() => void sync.start()} disabled={sync.starting || sync.loading}>Синк сейчас</button>
              )}
            </EmptyState>
          ) : items.length === 0 ? (
            <EmptyState
              icon="search-x" title="Ничего не найдено"
              text={filters.year !== null ? `За ${filters.year} год нет завершённых или брошенных игр с такими параметрами. Попробуй изменить запрос или фильтры.` : 'Попробуй изменить запрос или фильтры.'}
            >
              <button type="button" className="ps-btn ps-btn--ghost" onClick={() => setFilters(resetFilters(filters))}>Сбросить фильтры</button>
            </EmptyState>
          ) : filters.view === 'list' ? (
            <div className="ps-row-table" role="table" aria-label="Игры">
              <RowHeader sort={filters.sort} order={filters.order} onSort={(s) => setFilters({ sort: s, order: s === filters.sort ? ((filters.order ?? (s === 'title' ? 'asc' : 'desc')) === 'asc' ? 'desc' : 'asc') : null })} />
              {items.map((g) => <GameRow key={g.id} game={g} actions={actions} selectMode={selectMode} selected={selected.has(g.id)} now={now} />)}
            </div>
          ) : (
            <ul className="ps-grid">
              {items.map((g, i) => (
                <li key={g.id}><GameCard game={g} actions={actions} selectMode={selectMode} selected={selected.has(g.id)} active={i === 0 && g.status === 'playing'} /></li>
              ))}
            </ul>
          )}
        </div>

        {list && items.length > 0 && items.length < list.total && (
          <div className="ps-more">
            <button type="button" className="ps-btn" onClick={() => void loadMore()} disabled={more}>
              {more ? 'Загрузка…' : `Показать ещё (${formatNumber(list.total - items.length)})`}
            </button>
          </div>
        )}
        {listError && items.length > 0 && (
          <p className="ps-inline-error" role="status">Не удалось обновить список. Показаны последние данные. <button type="button" className="ps-link" onClick={refresh}>Повторить</button></p>
        )}
      </section>

      {selectMode && (
        <div className="ps-selbar" role="region" aria-label="Выбор игр">
          <span className="ps-selbar__n">Выбрано {selected.size}</span>
          <button type="button" className="ps-link" onClick={() => setSelected(new Set(items.map((g) => g.id)))}>Выбрать все ({items.length})</button>
          <span className="ps-section__spacer" />
          <StatusMenu onPick={(s) => void bulk(s)} label="Поставить статус" className="ps-selbar__menu">
            <span className={`ps-btn ps-btn--primary ${selected.size ? '' : 'ps-btn--off'}`} aria-disabled={!selected.size}>Поставить статус<Icon name="chevron-down" size={14} /></span>
          </StatusMenu>
          <button type="button" className="ps-btn" onClick={exitSelect}>Отмена</button>
        </div>
      )}

      <GameDialog
        game={openGame} startEditing={open?.edit ?? false} now={now} onClose={() => setOpen(null)}
        onStatus={(g, s) => void setStatus(g, s)} onDate={(g, k, iso) => void setDate(g, k, iso)}
      />
    </div>
  );
}

function FilterBarSlot(props: { filters: Filters; list: ListState | null; onChange: (p: Partial<Filters>) => void; onReset: () => void }) {
  return <FilterBar filters={props.filters} counts={props.list?.counts ?? null} years={props.list?.years ?? []} onChange={props.onChange} onReset={props.onReset} />;
}

function SyncProgress() {
  const { status } = useSync();
  const run = status?.run;
  if (!run) return null;
  const p = run.progress;
  const frac = progressFraction(run);
  const text = p && p.phase === 'games' && p.done !== null && p.total !== null ? `Загружено ${p.done} из ${p.total} игр` : phaseText(run);
  return (
    <div role="status" className="ps-empty__progress">
      <p>{text}</p>
      <div className="ps-bar" role="progressbar" aria-label="Прогресс синка" aria-valuemin={0} aria-valuemax={100} aria-valuenow={frac === null ? undefined : Math.round(frac * 100)}>
        <span style={{ width: `${Math.round((frac ?? 0.05) * 100)}%` }} />
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <ul className="ps-grid" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        <li key={i}><div className="ps-card ps-card--sk"><div className="ps-skeleton ps-sk-cover" /><div className="ps-sk-lines"><div className="ps-skeleton" /><div className="ps-skeleton" /></div></div></li>
      ))}
    </ul>
  );
}

function ListSkeleton() {
  return (
    <div className="ps-row-table" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => <div key={i} className="ps-skeleton ps-sk-row" />)}
    </div>
  );
}
