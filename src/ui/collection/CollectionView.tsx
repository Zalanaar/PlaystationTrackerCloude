'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CollectionSummaryResponse, GameItem, GameStatusValue, StatusCounts } from '@/server/collection/types';
import { EmptyState } from '../EmptyState';
import { cssUrl, formatNumber } from '../format';
import { Icon } from '../icons';
import { useNow, useViewportWidth } from '../primitives/hooks';
import { useToast } from '../primitives/Toast';
import { StatusMenu } from '../status';
import { useSync } from '../sync/SyncProvider';
import { buttonLabel, phaseText, progressFraction } from '../sync/status';
import { STATUS_META, type ViewMode } from '../tokens';
import { ApiError, errorText, fetchGames, fetchSummary, patchStatusDate, postBulk, putStatus } from './api';
import {
  blockGames, buildPlan, blockSort, blockStatuses, FULL_LIMIT, isFull, visibleBlocks, type BlockId,
} from './blocks';
import { BlockHead, MonthHeader, YearHeader } from './Chronicle';
import { defaultExpandedYears, emptyCounts, groupChronicle, gridCols, previewSlots } from './chronicle';
import { FilterBar } from './FilterBar';
import {
  adjustCounts, applyStatusLocally, blockQuery, effectiveView, filtersToApi, filtersToUrl, hasActiveFilters, isChronicleMode, matchesStatusTab,
  parseFilters, resetFilters, type Filters,
} from './filters';
import { GameCard, type GameActions } from './GameCard';
import { GameDialog } from './GameDialog';
import { GameGrid, GameGridItem } from './GameGrid';
import { GameRow, RowHeader } from './GameRow';
import { PlayingStrip } from './PlayingStrip';
import { StatLine } from './StatLine';
import { storeView, useStoredView } from './view';

const PAGE = 60;
const BULK_MAX = 250;

type DateRestore = { kind: 'completed' | 'dropped'; iso: string };
type Pool = { items: GameItem[]; counts: StatusCounts; total: number };

function oldDate(g: GameItem): DateRestore | undefined {
  if (g.status === 'completed' && g.completedAt) return { kind: 'completed', iso: g.completedAt };
  if (g.status === 'dropped' && g.droppedAt) return { kind: 'dropped', iso: g.droppedAt };
  return undefined;
}

function union(lists: GameItem[][]): GameItem[] {
  const seen = new Set<number>();
  const out: GameItem[] = [];
  for (const l of lists) for (const g of l) if (!seen.has(g.id)) { seen.add(g.id); out.push(g); }
  return out;
}

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

export function CollectionView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const stored = useStoredView();
  const view: ViewMode = effectiveView(filters, stored);
  const filtersKey = filtersToUrl({ ...filters, view: null }).toString();
  const toast = useToast();
  const now = useNow();
  const sync = useSync();
  const width = useViewportWidth();

  const [summary, setSummary] = useState<CollectionSummaryResponse | null>(null);
  const [pool, setPool] = useState<Pool | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [more, setMore] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<{ id: number; edit: boolean; snapshot: GameItem } | null>(null);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const poolRef = useRef<Pool | null>(null);
  useEffect(() => { poolRef.current = pool; }, [pool]);
  const reqId = useRef(0);
  const undoRef = useRef<((g: GameItem, s: GameStatusValue | null, silent?: boolean, restore?: DateRestore) => Promise<void>) | null>(null);
  const moreAbort = useRef<AbortController | null>(null);
  const filtersRef = useRef(filters);
  useEffect(() => { filtersRef.current = filters; }, [filters]);

  // ---------- загрузка ----------
  const loadSummary = useCallback(async () => {
    try {
      setSummary(await fetchSummary());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      /* сводка необязательна: строка итогов просто не показывается */
    }
  }, []);

  const loadAll = useCallback(async (f: Filters, keep: number) => {
    const id = ++reqId.current;
    moreAbort.current?.abort();
    setLoading(true);
    try {
      let next: Pool;
      if (isChronicleMode(f)) {
        const plan = buildPlan(f.status, f.q);
        const rs = await Promise.all(plan.map((p) => fetchGames(p.query)));
        const chronIdx = plan.findIndex((p) => p.block === 'chronicle');
        next = { items: union(rs.map((r) => r.items)), counts: rs[0].counts, total: chronIdx >= 0 ? rs[chronIdx].total : rs[0].total };
      } else {
        const r = await fetchGames(filtersToApi(f, { limit: Math.max(PAGE, keep), offset: 0 }));
        next = { items: r.items, counts: r.counts, total: r.total };
      }
      if (id !== reqId.current) return;
      setPool(next);
      setError(false);
    } catch {
      if (id !== reqId.current) return;
      setError(true);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadSummary(), 0);
    return () => clearTimeout(t);
  }, [loadSummary]);

  useEffect(() => {
    const t = setTimeout(() => {
      setSelected(new Set()); // выбор не должен захватывать игры из прошлой выдачи
      void loadAll(filtersRef.current, PAGE);
    }, 0);
    return () => clearTimeout(t);
  }, [filtersKey, loadAll]);

  const refresh = useCallback(() => {
    void loadSummary();
    void loadAll(filtersRef.current, poolRef.current?.items.length ?? 0);
  }, [loadAll, loadSummary]);

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

  /** Подгрузка: блок (хроника, целиком показанный блок) или плоский список. */
  async function loadMore(block: BlockId | null) {
    const p = poolRef.current;
    if (!p) return;
    const f = filtersRef.current;
    const id = reqId.current;
    moreAbort.current?.abort();
    const ac = new AbortController();
    moreAbort.current = ac;
    setMore(true);
    try {
      let query: URLSearchParams;
      if (block) {
        const have = blockGames(p.items, block, f.status).length;
        query = blockQuery(blockStatuses(block, f.status), blockSort(block), f.q, { limit: FULL_LIMIT, offset: have });
      } else {
        query = filtersToApi(f, { limit: PAGE, offset: p.items.length });
      }
      const r = await fetchGames(query, ac.signal);
      if (id !== reqId.current || ac.signal.aborted) return;
      setPool((l) => (l ? { ...l, counts: r.counts, total: block === 'chronicle' || !block ? r.total : l.total, items: union([l.items, r.items]) } : l));
    } catch (e) {
      if (id !== reqId.current || ac.signal.aborted) return;
      toast({ kind: 'error', text: `Не удалось загрузить ещё. ${errorText(e)}` });
    } finally {
      if (moreAbort.current === ac) setMore(false);
    }
  }

  // ---------- URL ----------
  const setFilters = useCallback((p: Partial<Filters>) => {
    // база: последнее запрошенное состояние, а не фильтры текущего рендера: два вызова в один кадр не теряются
    const next = { ...filtersRef.current, ...p };
    filtersRef.current = next;
    const qs = filtersToUrl(next).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router]);

  const setView = useCallback((v: ViewMode) => {
    storeView(v);
    setFilters({ view: v });
  }, [setFilters]);

  // ---------- локальное состояние игр ----------
  const replaceGames = useCallback((games: GameItem[]) => {
    const by = new Map(games.map((g) => [g.id, g]));
    setPool((l) => (l ? { ...l, items: l.items.map((g) => by.get(g.id) ?? g) } : l));
    setOpen((o) => (o && by.get(o.id) ? { ...o, snapshot: by.get(o.id) as GameItem } : o));
  }, []);

  const shiftCounts = useCallback((from: GameStatusValue | null, to: GameStatusValue | null) => {
    setPool((l) => (l ? { ...l, counts: adjustCounts(l.counts, from, to) } : l));
  }, []);

  const current = useCallback((g: GameItem): GameItem => {
    return poolRef.current?.items.find((x) => x.id === g.id) ?? g;
  }, []);

  const setStatus = useCallback(async (game: GameItem, status: GameStatusValue | null, silent = false, restore?: DateRestore) => {
    const prev = current(game);
    if (prev.status === status) return;
    replaceGames([applyStatusLocally(prev, status, new Date().toISOString())]);
    shiftCounts(prev.status, status);
    try {
      const r = await putStatus(prev.id, status);
      replaceGames([r.game]);
      if (silent && restore && restore.kind === status && new Date(restore.iso).getTime() <= Date.now()) {
        const have = restore.kind === 'completed' ? r.game.completedAt : r.game.droppedAt;
        if (have !== restore.iso) {
          try {
            const d = await patchStatusDate(prev.id, restore.kind, restore.iso);
            replaceGames([d.game]);
          } catch (e) {
            toast({ kind: 'error', text: `Статус возвращён, но дату не удалось восстановить. ${errorText(e)}` });
          }
        }
      }
      toast({
        text: silent ? 'Статус возвращён' : `Статус изменён: ${STATUS_META[status ?? 'none'].label}`,
        action: silent ? undefined : { label: 'Отменить', run: () => void undoRef.current?.(r.game, prev.status, true, oldDate(prev)) },
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
    const prevs = ids.map((id) => poolRef.current?.items.find((g) => g.id === id)).filter((g): g is GameItem => !!g);
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

  // ---------- производные данные ----------
  const chronicleMode = isChronicleMode(filters);
  const active = hasActiveFilters(filters);
  const counts = pool?.counts ?? emptyCounts();
  const all = useMemo(() => pool?.items ?? [], [pool]);
  const flat = useMemo(() => all.filter((g) => matchesStatusTab(g, filters.status)), [all, filters.status]);
  const blocks = useMemo(() => (chronicleMode ? visibleBlocks(filters.status) : []), [chronicleMode, filters.status]);
  const byBlock = useMemo(() => {
    const m = {} as Record<BlockId, GameItem[]>;
    for (const b of blocks) m[b] = blockGames(all, b, filters.status);
    return m;
  }, [all, blocks, filters.status]);
  const chron = useMemo(() => groupChronicle(byBlock.chronicle ?? []), [byBlock.chronicle]);
  const defaultOpen = useMemo(() => defaultExpandedYears(chron.years.map((y) => y.year), now), [chron.years, now]);
  const isOpen = (key: string | number) => (filters.q.trim() ? true : toggled[String(key)] ?? (typeof key === 'number' && defaultOpen.has(key)));
  const toggle = (key: string | number) => setToggled((t) => ({ ...t, [String(key)]: !isOpen(key) }));

  const density = view === 'dense' ? 'dense' : 'comfort';
  const cols = gridCols(width, density);
  const visibleChron = [
    ...chron.years.filter((y) => isOpen(y.year)).flatMap((y) => y.months.flatMap((m) => m.games)),
    ...(isOpen('undated') ? chron.undated : []),
  ];
  const shownGames = chronicleMode ? blocks.flatMap((b) => (b === 'chronicle' ? visibleChron : byBlock[b])) : flat;
  const empty = !!pool && (chronicleMode ? blocks.every((b) => byBlock[b].length === 0) : flat.length === 0);
  const noData = !!pool && pool.counts.all === 0 && !active && !error;
  const playing = byBlock.playing ?? [];
  const openGame = open ? (all.find((g) => g.id === open.id) ?? open.snapshot) : null;
  const run = sync.status?.run;
  const syncing = !!sync.status?.running;

  // Activity: арт страницы = обложка первой игры из ленты «Играю»
  const art = cssUrl(chronicleMode ? playing[0]?.coverUrl : null);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.ps-app');
    if (!root) return;
    if (art) root.style.setProperty('--page-art', art);
    else root.style.removeProperty('--page-art');
    return () => { root.style.removeProperty('--page-art'); };
  }, [art]);

  // ---------- вывод ----------
  function renderGames(list: GameItem[], opts: { dateYear?: boolean; withHeader?: boolean } = {}): ReactNode {
    if (view === 'list') {
      return (
        <div className="ps-row-table" role="table" aria-label="Игры">
          {opts.withHeader && (
            <RowHeader sort={filters.sort} order={filters.order} onSort={(s) => setFilters({ sort: s, order: s === filters.sort ? ((filters.order ?? (s === 'title' ? 'asc' : 'desc')) === 'asc' ? 'desc' : 'asc') : null })} />
          )}
          {list.map((g) => <GameRow key={g.id} game={g} actions={actions} selectMode={selectMode} selected={selected.has(g.id)} />)}
        </div>
      );
    }
    return (
      <GameGrid density={density}>
        {list.map((g) => (
          <GameGridItem key={g.id}><GameCard game={g} actions={actions} selectMode={selectMode} selected={selected.has(g.id)} dateWithYear={opts.dateYear} /></GameGridItem>
        ))}
      </GameGrid>
    );
  }

  /** Превью одним рядом: cols - 1 обложек и плитка «+N ещё». */
  function renderPreview(list: GameItem[], total: number, tile: ReactNode): ReactNode {
    const slots = previewSlots(total, view === 'list' ? 5 : cols);
    const shown = list.slice(0, slots.shown);
    if (view === 'list') {
      return (
        <>
          {renderGames(shown)}
          {slots.rest > 0 && <div className="ps-preview__more">{tile}</div>}
        </>
      );
    }
    return (
      <GameGrid density={density}>
        {shown.map((g) => (
          <GameGridItem key={g.id}><GameCard game={g} actions={actions} selectMode={selectMode} selected={selected.has(g.id)} /></GameGridItem>
        ))}
        {slots.rest > 0 && <GameGridItem>{tile}</GameGridItem>}
      </GameGrid>
    );
  }

  const moreBtn = (block: BlockId | null, remaining: number) => remaining > 0 && (
    <div className="ps-more">
      <button type="button" className="ps-btn" onClick={() => void loadMore(block)} disabled={more}>
        {more ? 'Загрузка…' : `Показать ещё (${formatNumber(remaining)})`}
      </button>
    </div>
  );

  function renderChronicle(): ReactNode {
    const loaded = byBlock.chronicle?.length ?? 0;
    const totalChron = filters.status === 'completed' ? counts.completed : filters.status === 'dropped' ? counts.dropped : counts.completed + counts.dropped;
    return (
      <>
        {chron.years.map((y) => {
          const open = isOpen(y.year);
          return (
            <section key={y.year} className="ps-chron" id={`y${y.year}`} aria-labelledby={`h${y.year}`}>
              <YearHeader
                id={`h${y.year}`} label={String(y.year)} completed={y.completed} dropped={y.dropped} hours={Math.round(y.seconds / 3600)}
                expanded={open} onToggle={() => toggle(y.year)} hint sectionId={`y${y.year}-body`}
              />
              <div id={`y${y.year}-body`} hidden={!open}>
                {open && y.months.map((m) => (
                  <div key={m.month} className="ps-chron__month">
                    <MonthHeader m={m} />
                    {renderGames(m.games)}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
        {chron.undated.length > 0 && (
          <section className="ps-chron" id="undated" aria-labelledby="h-undated">
            <YearHeader
              id="h-undated" label="Без даты" completed={chron.undatedCompleted} dropped={chron.undatedDropped} hours={null}
              expanded={isOpen('undated')} onToggle={() => toggle('undated')} sectionId="undated-body"
            />
            <div id="undated-body" hidden={!isOpen('undated')}>
              {isOpen('undated') && <div className="ps-chron__month">{renderGames(chron.undated)}</div>}
            </div>
          </section>
        )}
        {moreBtn('chronicle', totalChron - loaded)}
      </>
    );
  }

  function renderBlock(b: BlockId): ReactNode {
    const list = byBlock[b] ?? [];
    if (b === 'playing') return null; // лента рисуется отдельно
    if (b === 'chronicle') return list.length > 0 ? <div className="ps-block" key={b}>{renderChronicle()}</div> : null;
    const full = isFull(b, filters.status);
    const total = counts[b === 'backlog' ? 'backlog' : b === 'shelved' ? 'shelved' : 'none'];
    if (list.length === 0) return null;
    const titles: Record<string, string> = { backlog: 'Бэклог', shelved: 'Отложено', unsorted: 'Не разобрано' };
    const id = b === 'unsorted' ? 'unsorted' : b;
    return (
      <section key={b} className="ps-block" id={id} aria-labelledby={`h-${id}`}>
        <BlockHead id={`h-${id}`} title={titles[b]} count={total}>
          {b === 'backlog' && <Link href="/backlog" className="ps-link ps-link--plain">Все <Icon name="arrow-right" size={14} /></Link>}
          {b === 'unsorted' && <Link href="/triage" className="ps-btn ps-btn--primary">Разобрать по одной</Link>}
        </BlockHead>
        {full ? renderGames(list) : renderPreview(list, total, (
          b === 'backlog'
            ? <Link href="/backlog" className="ps-more-tile"><b className="num">+{formatNumber(previewSlots(total, view === 'list' ? 5 : cols).rest)}</b><span>ещё в бэклоге</span></Link>
            : <button type="button" className="ps-more-tile" onClick={() => setFilters({ status: 'none' })}><b className="num">+{formatNumber(previewSlots(total, view === 'list' ? 5 : cols).rest)}</b><span>ещё не разобрано</span></button>
        ))}
        {full && moreBtn(b, total - list.length)}
      </section>
    );
  }

  const years = chron.years.map((y) => y.year);
  const showAnchors = chronicleMode && filters.status === 'all' && (years.length > 0 || (byBlock.backlog?.length ?? 0) > 0 || (byBlock.unsorted?.length ?? 0) > 0);
  function jump(e: React.MouseEvent, target: string, year?: number) {
    e.preventDefault();
    if (year !== undefined) setToggled((t) => ({ ...t, [String(year)]: true }));
    setTimeout(() => scrollToId(target), 30);
  }

  return (
    <div className="ps-collection">
      <div className="ps-pagehead">
        <h1 id="coll-title" className="ps-h1">Коллекция</h1>
        <StatLine totals={summary?.totals ?? null} loading={!summary && !pool} />
      </div>

      {chronicleMode && blocks.includes('playing') && <PlayingStrip games={playing} count={counts.playing} now={now} actions={actions} />}

      <FilterBar
        filters={filters} view={view} counts={pool ? counts : null} onChange={setFilters} onView={setView}
        onReset={() => setFilters(resetFilters(filters))} selectMode={selectMode} onSelect={() => (selectMode ? exitSelect() : setSelectMode(true))}
        canSelect={shownGames.length > 0}
      />

      {showAnchors && (
        <nav className="ps-anchors" aria-label="Годы и блоки">
          <span>Перейти:</span>
          {years.map((y) => <a key={y} href={`#y${y}`} onClick={(e) => jump(e, `y${y}`, y)}>{y}</a>)}
          {(byBlock.backlog?.length ?? 0) > 0 && <a href="#backlog" onClick={(e) => jump(e, 'backlog')}>Бэклог</a>}
          {(byBlock.unsorted?.length ?? 0) > 0 && <a href="#unsorted" onClick={(e) => jump(e, 'unsorted')}>Не разобрано</a>}
        </nav>
      )}

      <section aria-labelledby="coll-title" aria-busy={loading} className="ps-results" data-loading={(loading && !!pool) || undefined}>
        {!pool && loading ? (
          <CollectionSkeleton view={view} />
        ) : error && !pool ? (
          <EmptyState icon="circle-alert" role="alert" title="Что-то пошло не так" text="Не удалось загрузить коллекцию. Сохранённые данные не потеряны.">
            <button type="button" className="ps-btn ps-btn--primary" onClick={() => void loadAll(filters, PAGE)}>Обновить</button>
          </EmptyState>
        ) : noData ? (
          <EmptyState icon="cloud-download" title="Пока пусто" text="Данные из PSN ещё не загружены. Запусти первый синк, он займёт несколько минут.">
            {syncing && run ? (
              <SyncProgress />
            ) : (
              <button type="button" className="ps-btn ps-btn--primary" onClick={() => void sync.start()} disabled={sync.starting || sync.loading}>
                {sync.status ? buttonLabel(sync.status, sync.starting) : 'Синк сейчас'}
              </button>
            )}
          </EmptyState>
        ) : empty ? (
          <EmptyState icon="search-x" title="Ничего не найдено" text="Попробуй изменить запрос или фильтры.">
            <button type="button" className="ps-btn ps-btn--ghost" onClick={() => setFilters(resetFilters(filters))}>Сбросить фильтры</button>
          </EmptyState>
        ) : chronicleMode ? (
          <div className="ps-blocks">{blocks.map((b) => renderBlock(b))}</div>
        ) : (
          <div className="ps-block">
            <BlockHead title="Результаты" count={pool?.total ?? 0} />
            {renderGames(flat, { dateYear: true, withHeader: true })}
            {pool && moreBtn(null, pool.total - all.length)}
          </div>
        )}
        {error && pool && (
          <p className="ps-inline-error" role="status">Не удалось обновить список. Показаны последние данные. <button type="button" className="ps-link" onClick={refresh}>Повторить</button></p>
        )}
      </section>

      {selectMode && (
        <SelectBar
          count={selected.size} total={shownGames.length} onAll={() => setSelected(new Set(shownGames.map((g) => g.id)))}
          onPick={(s) => void bulk(s)} onCancel={exitSelect}
        />
      )}

      <GameDialog
        game={openGame} startEditing={open?.edit ?? false} now={now} onClose={() => setOpen(null)}
        onStatus={(g, s) => void setStatus(g, s)} onDate={(g, k, iso) => void setDate(g, k, iso)}
      />
    </div>
  );
}


function SelectBar({
  count, total, onAll, onPick, onCancel,
}: { count: number; total: number; onAll: () => void; onPick: (s: GameStatusValue | null) => void; onCancel: () => void }) {
  return (
    <div className="ps-selbar" role="region" aria-label="Выбор игр">
      <span className="ps-selbar__n">Выбрано {count}</span>
      <button type="button" className="ps-link" onClick={onAll}>Выбрать все ({total})</button>
      <span className="ps-section__spacer" />
      <StatusMenu onPick={onPick} label="Поставить статус" className="ps-selbar__menu">
        <span className={`ps-btn ps-btn--primary ${count ? '' : 'ps-btn--off'}`} aria-disabled={!count}>Поставить статус<Icon name="chevron-down" size={14} /></span>
      </StatusMenu>
      <button type="button" className="ps-btn" onClick={onCancel}>Отмена</button>
    </div>
  );
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

export function CollectionSkeleton({ view = 'comfort' }: { view?: ViewMode }) {
  return (
    <div aria-hidden="true" className="ps-blocks">
      <div className="ps-skeleton ps-sk-strip" />
      <div className="ps-skeleton ps-sk-year" />
      {view === 'list' ? (
        <div className="ps-row-table">{Array.from({ length: 10 }, (_, i) => <div key={i} className="ps-skeleton ps-sk-row" />)}</div>
      ) : (
        <ul className="ps-grid" data-density={view}>
          {Array.from({ length: 12 }, (_, i) => (
            <li key={i}><div className="ps-card ps-card--sk"><div className="ps-skeleton ps-sk-cover" /><div className="ps-skeleton ps-sk-line" /></div></li>
          ))}
        </ul>
      )}
    </div>
  );
}
