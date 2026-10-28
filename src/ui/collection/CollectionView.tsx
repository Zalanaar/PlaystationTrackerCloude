'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CollectionSummaryResponse, GameItem, GameStatusValue, StatusCounts } from '@/server/collection/types';
import { EmptyState } from '../EmptyState';
import { cssUrl, formatNumber, plural } from '../format';
import { Icon, StatusGlyph } from '../icons';
import { useNow, useViewportWidth } from '../primitives/hooks';
import { useToast } from '../primitives/Toast';
import { StatusMenu } from '../status';
import { useSync } from '../sync/SyncProvider';
import { buttonLabel, phaseText, progressFraction } from '../sync/status';
import { STATUS_META, type ViewMode } from '../tokens';
import { ApiError, errorText, fetchGames, fetchSummary, patchStatusDate, postBulk, postResetAll, postRestore, putHidden, putStatus } from './api';
import {
  blockGames, buildPlan, blockSort, inBlock, blockStatuses, FULL_LIMIT, isFull, visibleBlocks, type BlockId,
} from './blocks';
import { BlockHead, GamesFact, MonthHeader, YearHeader } from './Chronicle';
import { defaultExpandedYears, emptyCounts, groupByLastPlayedYear, groupChronicle, gridCols, previewSlots } from './chronicle';
import { FilterBar } from './FilterBar';
import {
  adjustCounts, applyStatusLocally, blockQuery, effectiveView, filtersToApi, filtersToUrl, hasActiveFilters, isChronicleMode, matchesStatusTab,
  parseFilters, removeFromCounts, resetFilters, type Filters,
} from './filters';
import { GameCard, type GameActions } from './GameCard';
import { GameDialog } from './GameDialog';
import { GameGrid, GameGridItem } from './GameGrid';
import { GameRow, RowHeader } from './GameRow';
import { mapLimit } from './limit';
import { PlayingStrip } from './PlayingStrip';
import { ResetAllDialog } from './ResetAllDialog';
import { StatLine } from './StatLine';
import { storeView, useStoredView } from './view';

const PAGE = 60;
const BULK_MAX = 250;
const SERVICE_ROWS = 5;
const SERVICE_ROWS_STEP = 10;
/** Параллельных PUT /hidden при массовом скрытии */
const HIDE_PARALLEL = 5;
/** Тост с откатом массовых действий висит дольше обычного */
const UNDO_TTL_MS = 12_000;
const gamesWord = (n: number) => plural(n, ['игра', 'игры', 'игр']);

type DateRestore = { kind: 'completed' | 'dropped'; iso: string };
type Pool = { items: GameItem[]; counts: StatusCounts; total: number; failed: BlockId[] };
const BLOCK_TITLES: Record<BlockId, string> = { playing: 'Играю', chronicle: 'Хроника', backlog: 'Бэклог', service: 'Игры-сервисы', shelved: 'Отложено', unsorted: 'Не разобрано' };

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
  // блок «Игры-сервисы»: раскрыт ли, и сколько строк показано в режиме «Список»
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceRows, setServiceRows] = useState(SERVICE_ROWS);
  const [resetOpen, setResetOpen] = useState(false);

  const poolRef = useRef<Pool | null>(null);
  useEffect(() => { poolRef.current = pool; }, [pool]);
  const reqId = useRef(0);
  const undoRef = useRef<((g: GameItem, s: GameStatusValue | null, silent?: boolean, restore?: DateRestore) => Promise<void>) | null>(null);
  const hideRef = useRef<((g: GameItem, hidden: boolean, silent?: boolean) => Promise<void>) | null>(null);
  const bulkHideRef = useRef<((ids: number[], hidden: boolean, silent?: boolean) => Promise<void>) | null>(null);
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
        const rs = await Promise.allSettled(plan.map((p) => fetchGames(p.query)));
        const ok = rs.flatMap((r, i) => (r.status === 'fulfilled' ? [{ block: plan[i].block, r: r.value }] : []));
        if (ok.length === 0) {
          const first = rs[0];
          if (first.status === 'rejected' && first.reason instanceof ApiError && first.reason.status === 401) return;
          throw new Error('all blocks failed');
        }
        const failed = plan.filter((_, i) => rs[i].status === 'rejected').map((p) => p.block);
        // у упавшего блока остаются ранее загруженные игры его статусов
        const kept = (poolRef.current?.items ?? []).filter((g) => failed.some((b) => inBlock(g, b, f.status)));
        const chron = ok.find((x) => x.block === 'chronicle');
        next = { items: union([...ok.map((x) => x.r.items), kept]), counts: ok[0].r.counts, total: chron ? chron.r.total : ok[0].r.total, failed };
      } else {
        const r = await fetchGames(filtersToApi(f, { limit: Math.max(PAGE, keep), offset: 0 }));
        next = { items: r.items, counts: r.counts, total: r.total, failed: [] };
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
        text: silent ? 'Статус возвращён' : status === null ? 'Статус сброшен' : `Статус изменён: ${STATUS_META[status].label}`,
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

  /** Игры ушли из текущей выдачи (скрыты или возвращены из «Скрытых»): убрать локально до перезагрузки. */
  const dropFromPool = useCallback((ids: number[]) => {
    const set = new Set(ids);
    setPool((l) => {
      if (!l) return l;
      let counts = l.counts;
      let total = l.total;
      for (const g of l.items) if (set.has(g.id)) { counts = removeFromCounts(counts, g.status); total = Math.max(0, total - 1); }
      return { ...l, counts, total, items: l.items.filter((g) => !set.has(g.id)) };
    });
    setSelected((s) => new Set([...s].filter((id) => !set.has(id))));
    setOpen((o) => (o && set.has(o.id) ? null : o));
  }, []);

  /** Убрать из коллекции / вернуть одну игру (9.7). Toast «Вернуть» после скрытия. */
  const setHidden = useCallback(async (game: GameItem, hidden: boolean, silent = false) => {
    const prev = current(game);
    const inView = !!poolRef.current?.items.some((g) => g.id === prev.id);
    try {
      const r = await putHidden(prev.id, hidden);
      if (inView) dropFromPool([prev.id]);
      toast({
        text: hidden ? `«${prev.title}» убрана из коллекции` : `«${prev.title}» возвращена в коллекцию`,
        action: hidden && !silent ? { label: 'Вернуть', run: () => void hideRef.current?.(r.game, false, true) } : undefined,
      });
      refresh();
    } catch (e) {
      toast({ kind: 'error', text: `${hidden ? 'Не удалось убрать игру' : 'Не удалось вернуть игру'}. ${errorText(e)}` });
    }
  }, [current, dropFromPool, refresh, toast]);

  useEffect(() => { hideRef.current = setHidden; }, [setHidden]);

  /** Массово: PUT /hidden на каждую игру, не больше HIDE_PARALLEL одновременно; итог одним тостом. */
  const bulkHidden = useCallback(async (ids: number[], hidden: boolean, silent = false) => {
    if (!ids.length) return;
    const r = await mapLimit(ids, HIDE_PARALLEL, (id) => putHidden(id, hidden));
    const done = r.ok.map((o) => o.item);
    dropFromPool(done);
    const verb = hidden ? 'Убрано из коллекции' : 'Возвращено в коллекцию';
    const undo = hidden && !silent && done.length > 0 ? { label: 'Вернуть', run: () => void bulkHideRef.current?.(done, false, true) } : undefined;
    if (r.failed.length === 0) {
      toast({ text: `${verb}: ${formatNumber(done.length)} ${gamesWord(done.length)}`, action: undo, ttl: undo ? UNDO_TTL_MS : undefined });
    } else {
      toast({
        kind: 'error', action: undo, ttl: UNDO_TTL_MS,
        text: `${verb}: ${formatNumber(done.length)} из ${formatNumber(ids.length)}. Не удалось: ${formatNumber(r.failed.length)}. ${errorText(r.failed[0].error)}`,
      });
    }
    if (!silent) {
      setSelected(new Set());
      setSelectMode(false);
    }
    refresh();
  }, [dropFromPool, refresh, toast]);

  useEffect(() => { bulkHideRef.current = bulkHidden; }, [bulkHidden]);

  /** Откат сброса всех статусов из копии (9.9). */
  const restoreBackup = useCallback(async (backupId: number) => {
    try {
      const r = await postRestore(backupId);
      toast({ text: `Статусы возвращены: ${formatNumber(r.restored)} ${gamesWord(r.restored)}` });
    } catch (e) {
      toast({ kind: 'error', text: e instanceof ApiError && e.status === 404 ? 'Копия статусов не найдена, вернуть нельзя.' : `Не удалось вернуть статусы. ${errorText(e)}` });
    }
    refresh();
  }, [refresh, toast]);

  /** Сброс всех статусов (9.8). Ошибку показывает окно подтверждения. */
  const resetAll = useCallback(async () => {
    const r = await postResetAll();
    setResetOpen(false);
    if (r.backupId === null || r.reset === 0) {
      toast({ text: 'Сбрасывать нечего: у игр нет статусов' });
      return;
    }
    const backupId = r.backupId;
    toast({
      text: `Статусы сброшены: ${formatNumber(r.reset)} ${gamesWord(r.reset)}`, ttl: UNDO_TTL_MS,
      action: { label: 'Вернуть', run: () => void restoreBackup(backupId) },
    });
    refresh();
  }, [refresh, restoreBackup, toast]);

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
  // «По последней игре»: плоская выдача сервера, разбитая по годам последнего запуска (МСК); все группы раскрыты по умолчанию
  const playedMode = !chronicleMode && filters.sort === 'last_played';
  const played = useMemo(() => groupByLastPlayedYear(playedMode ? flat : [], filters.order ?? 'desc'), [flat, filters.order, playedMode]);
  const isPlayedOpen = (key: string) => (filters.q.trim() ? true : toggled[`lp-${key}`] ?? true);
  const togglePlayed = (key: string) => setToggled((t) => ({ ...t, [`lp-${key}`]: !isPlayedOpen(key) }));

  const density = view === 'dense' ? 'dense' : 'comfort';
  const cols = gridCols(width, density);
  const visibleChron = [
    ...chron.years.filter((y) => isOpen(y.year)).flatMap((y) => y.months.flatMap((m) => m.games)),
    ...(isOpen('undated') ? chron.undated : []),
  ];
  // «Игры-сервисы»: вкладка «Сервис» раскрывает блок целиком, иначе один ряд (сетка) или несколько строк (список)
  const serviceAll = byBlock.service ?? [];
  const serviceFull = filters.status === 'service';
  const serviceLimit = serviceFull ? Infinity : view === 'list' ? serviceRows : serviceOpen ? Infinity : cols;
  const shownGames = chronicleMode
    ? blocks.flatMap((b) => (b === 'chronicle' ? visibleChron : b === 'service' ? serviceAll.slice(0, serviceLimit) : byBlock[b]))
    : playedMode
      ? [...played.years.filter((y) => isPlayedOpen(String(y.year))).flatMap((y) => y.games), ...(isPlayedOpen('never') ? played.never : [])]
      : flat;
  const failedBlocks = pool?.failed ?? [];
  const empty = !!pool && failedBlocks.length === 0 && (chronicleMode ? blocks.every((b) => byBlock[b].length === 0) : flat.length === 0);
  const hiddenView = filters.hidden;
  const noData = !!pool && pool.counts.all === 0 && !active && !error && !hiddenView;
  const hiddenEmpty = hiddenView && !!pool && pool.counts.all === 0 && !active && !error;
  const withStatus = summary ? summary.counts.all - summary.counts.none : null;
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
          <GameGridItem key={g.id}>
            <GameCard game={g} actions={actions} selectMode={selectMode} selected={selected.has(g.id)} dateWithYear={opts.dateYear}>
              {hiddenView && !selectMode && (
                <button type="button" className="ps-btn ps-btn--sm ps-card__restore" aria-label={`Вернуть в коллекцию: ${g.title}`} onClick={() => void setHidden(g, false)}>
                  <Icon name="undo" size={14} /><span>Вернуть в коллекцию</span>
                </button>
              )}
            </GameCard>
          </GameGridItem>
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
                expanded={open} onToggle={() => toggle(y.year)} hint="дата завершения, МСК" sectionId={`y${y.year}-body`}
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

  /** «По последней игре»: группы по году последнего запуска, затем «Не запускались». Подгрузка дописывает игры в последнюю группу. */
  function renderPlayed(): ReactNode {
    const group = (key: string, label: string, games: GameItem[], hours: number | null) => {
      const open = isPlayedOpen(key);
      const sid = key === 'never' ? 'never' : `y${key}`;
      return (
        <section key={key} className="ps-chron" id={sid} aria-labelledby={`h-${sid}`}>
          <YearHeader
            id={`h-${sid}`} label={label} facts={<GamesFact n={games.length} />} hours={hours}
            expanded={open} onToggle={() => togglePlayed(key)} hint={key === 'never' ? undefined : 'последний запуск, МСК'} sectionId={`${sid}-body`}
          />
          <div id={`${sid}-body`} className="ps-chron__flat" hidden={!open}>
            {open && renderGames(games, { dateYear: true, withHeader: true })}
          </div>
        </section>
      );
    };
    return (
      <>
        {played.years.map((y) => group(String(y.year), String(y.year), y.games, Math.round(y.seconds / 3600)))}
        {played.never.length > 0 && group('never', 'Не запускались', played.never, null)}
      </>
    );
  }

  /** Блок «Игры-сервисы» (§4.3.1): один ряд + «Показать ещё {N}» / «Свернуть». */
  function renderService(list: GameItem[]): ReactNode {
    const total = Math.max(counts.service, list.length);
    const isList = view === 'list';
    const card = (g: GameItem) => (
      <GameGridItem key={g.id}><GameCard game={g} actions={actions} selectMode={selectMode} selected={selected.has(g.id)} /></GameGridItem>
    );
    let body: ReactNode;
    let toggleBtn: ReactNode = null;
    if (isList) {
      const shown = serviceFull ? list : list.slice(0, serviceRows);
      body = renderGames(shown);
      if (!serviceFull) {
        const rest = total - shown.length;
        if (rest > 0) {
          toggleBtn = (
            <button type="button" className="ps-btn ps-btn--ghost" data-testid="service-toggle" onClick={() => setServiceRows((n) => n + SERVICE_ROWS_STEP)}>
              Показать ещё {formatNumber(rest)}
            </button>
          );
        } else if (list.length > SERVICE_ROWS) {
          toggleBtn = <button type="button" className="ps-btn ps-btn--ghost" data-testid="service-toggle" onClick={() => setServiceRows(SERVICE_ROWS)}>Свернуть</button>;
        }
      }
    } else {
      const expanded = serviceFull || serviceOpen;
      const rest = total - cols;
      body = (
        <>
          <GameGrid density={density}>{list.slice(0, cols).map(card)}</GameGrid>
          {list.length > cols && (
            <div className="ps-collapse" data-open={expanded || undefined} id="service-more">
              <div className="ps-collapse__in">
                <div className="ps-collapse__pad"><GameGrid density={density}>{list.slice(cols).map(card)}</GameGrid></div>
              </div>
            </div>
          )}
        </>
      );
      if (!serviceFull && rest > 0) {
        toggleBtn = (
          <button
            type="button" className="ps-btn ps-btn--ghost" data-testid="service-toggle" aria-expanded={serviceOpen} aria-controls="service-more"
            onClick={() => setServiceOpen((o) => !o)}
          >
            {serviceOpen ? 'Свернуть' : `Показать ещё ${formatNumber(rest)}`}
          </button>
        );
      }
    }
    return (
      <section key="service" className="ps-block" id="service" aria-labelledby="h-service">
        <BlockHead id="h-service" title="Игры-сервисы" count={total} icon={<StatusGlyph status="service" size={16} />} />
        {body}
        {toggleBtn && <div className="ps-more ps-more--service">{toggleBtn}</div>}
        {(serviceFull || (!isList && serviceOpen)) && moreBtn('service', total - list.length)}
      </section>
    );
  }

  function renderBlock(b: BlockId): ReactNode {
    const list = byBlock[b] ?? [];
    if (b === 'playing') return null; // лента рисуется отдельно
    if (b === 'chronicle') return list.length > 0 ? <div className="ps-block" key={b}>{renderChronicle()}</div> : null;
    if (b === 'service') return list.length > 0 ? renderService(list) : null;
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
  const showAnchors = chronicleMode && filters.status === 'all' && (years.length > 0 || (byBlock.backlog?.length ?? 0) > 0 || (byBlock.service?.length ?? 0) > 0 || (byBlock.unsorted?.length ?? 0) > 0);
  function jump(e: React.MouseEvent, target: string, year?: number) {
    e.preventDefault();
    if (year !== undefined) setToggled((t) => ({ ...t, [String(year)]: true }));
    setTimeout(() => scrollToId(target), 30);
  }
  function jumpPlayed(e: React.MouseEvent, key: string) {
    e.preventDefault();
    setToggled((t) => ({ ...t, [`lp-${key}`]: true }));
    setTimeout(() => scrollToId(key === 'never' ? 'never' : `y${key}`), 30);
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
        canSelect={shownGames.length > 0} onHidden={(v) => { exitSelect(); setFilters({ hidden: v, status: 'all' }); }} onResetAll={() => setResetOpen(true)}
      />

      {playedMode && played.years.length + (played.never.length > 0 ? 1 : 0) > 1 && (
        <nav className="ps-anchors" aria-label="Годы">
          <span>Перейти:</span>
          {played.years.map((y) => <a key={y.year} href={`#y${y.year}`} onClick={(e) => jumpPlayed(e, String(y.year))}>{y.year}</a>)}
          {played.never.length > 0 && <a href="#never" onClick={(e) => jumpPlayed(e, 'never')}>Не запускались</a>}
        </nav>
      )}

      {showAnchors && (
        <nav className="ps-anchors" aria-label="Годы и блоки">
          <span>Перейти:</span>
          {years.map((y) => <a key={y} href={`#y${y}`} onClick={(e) => jump(e, `y${y}`, y)}>{y}</a>)}
          {(byBlock.backlog?.length ?? 0) > 0 && <a href="#backlog" onClick={(e) => jump(e, 'backlog')}>Бэклог</a>}
          {(byBlock.service?.length ?? 0) > 0 && <a href="#service" onClick={(e) => jump(e, 'service')}>Сервисы</a>}
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
        ) : hiddenEmpty ? (
          <EmptyState icon="eye-off" title="Скрытых игр нет" text="Здесь появятся игры, которые ты убрал из коллекции. Их можно вернуть в любой момент.">
            <button type="button" className="ps-btn ps-btn--ghost" onClick={() => setFilters({ hidden: false, status: 'all' })}>К коллекции</button>
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
          <div className="ps-blocks">
            {blocks.map((b) => (
              <Fragment key={b}>
                {failedBlocks.includes(b) && (
                  <p className="ps-inline-error ps-block-error" role="alert">
                    <Icon name="circle-alert" size={18} />
                    <span>Не удалось загрузить блок «{BLOCK_TITLES[b]}».</span>
                    <button type="button" className="ps-link" onClick={() => void loadAll(filtersRef.current, 0)}>Повторить</button>
                  </p>
                )}
                {renderBlock(b)}
              </Fragment>
            ))}
          </div>
        ) : (
          <div className="ps-block">
            {hiddenView ? (
              <>
                <BlockHead title="Скрытые игры" count={pool?.total ?? 0} icon={<Icon name="eye-off" size={18} />}>
                  <button type="button" className="ps-link ps-link--plain" onClick={() => setFilters({ hidden: false, status: 'all' })}>
                    К коллекции <Icon name="arrow-right" size={14} />
                  </button>
                </BlockHead>
                <p className="ps-block__note">Эти игры не показываются в коллекции, статистике и итогах. Синк их не возвращает.</p>
              </>
            ) : (
              <BlockHead title="Результаты" count={pool?.total ?? 0} />
            )}
            {playedMode ? renderPlayed() : renderGames(flat, { dateYear: true, withHeader: true })}
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
          onPick={(s) => void bulk(s)} onCancel={exitSelect} hiddenView={hiddenView}
          onHide={() => void bulkHidden([...selected], !hiddenView)}
        />
      )}

      <GameDialog
        game={openGame} startEditing={open?.edit ?? false} now={now} onClose={() => setOpen(null)}
        onStatus={(g, s) => void setStatus(g, s)} onDate={(g, k, iso) => void setDate(g, k, iso)}
        onHidden={(g, h) => void setHidden(g, h)}
      />

      <ResetAllDialog open={resetOpen} count={withStatus} onClose={() => setResetOpen(false)} onConfirm={resetAll} />
    </div>
  );
}


function SelectBar({
  count, total, onAll, onPick, onCancel, hiddenView, onHide,
}: {
  count: number; total: number; onAll: () => void; onPick: (s: GameStatusValue | null) => void; onCancel: () => void;
  /** в «Скрытых» вместо статусов одна кнопка «Вернуть в коллекцию» (статусы скрытых массово не меняются, 9.6) */
  hiddenView: boolean; onHide: () => void;
}) {
  return (
    <div className="ps-selbar" role="region" aria-label="Выбор игр">
      <span className="ps-selbar__n">Выбрано {count}</span>
      <button type="button" className="ps-link" onClick={onAll}>Выбрать все ({total})</button>
      <span className="ps-section__spacer" />
      {hiddenView ? (
        <button type="button" className="ps-btn ps-btn--primary" disabled={!count} onClick={onHide}>
          <Icon name="undo" size={16} />Вернуть в коллекцию
        </button>
      ) : (
        <>
          <StatusMenu onPick={onPick} label="Поставить статус" className="ps-selbar__menu">
            <span className={`ps-btn ps-btn--primary ${count ? '' : 'ps-btn--off'}`} aria-disabled={!count}>Поставить статус<Icon name="chevron-down" size={14} /></span>
          </StatusMenu>
          <button type="button" className="ps-btn" aria-label="Сбросить статус" title="Сбросить статус" disabled={!count} onClick={() => onPick(null)}>
            <Icon name="undo" size={16} /><span className="ps-btn__t">Сбросить статус</span>
          </button>
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--danger" aria-label="Убрать из коллекции" title="Убрать из коллекции" disabled={!count} onClick={onHide}>
            <Icon name="eye-off" size={16} /><span className="ps-btn__t">Убрать из коллекции</span>
          </button>
        </>
      )}
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
