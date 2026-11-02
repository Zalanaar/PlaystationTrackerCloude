'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DurationCounts, GameItem, GenreCounts, GameStatusValue, HltbCounts } from '@/server/collection/types';
import '../backlog.css';
import { EmptyState } from '../EmptyState';
import { formatNumber } from '../format';
import { Icon, StatusGlyph } from '../icons';
import { useToast } from '../primitives/Toast';
import { STATUS_META } from '../tokens';
import { ApiError, errorText, fetchGames, putStatus } from './api';
import { mskDay } from '../inbox/model';
import { MatchChip } from '../inbox/MatchChip';
import { ManualCard, ManualRow } from './ManualItems';
import type { ManualHandlers } from './manualMenu';
import {
  countNotPurchased, isGoneOrDone, manualErrorText, mergeBacklog, removeManualById, setNotPurchased, truncate, visibleManual, type ManualGame,
} from './manual';
import { addedSummaryText, hasNotPurchased } from './cart';
import { BacklogSearch, type SearchPick } from './BacklogSearch';
import { NotPurchasedSection, readNbOpen, writeNbOpen } from './NotPurchasedSection';
import { Sheet } from '../primitives/Sheet';
import type { AddedItem } from './AddFromStoreSheet';
import { fetchManual, markPurchased, removeManual, unmarkPurchased } from './manualApi';
import { RemoveManualSheet } from './RemoveManualSheet';
import { BacklogFilters } from './BacklogFilters';
import { BacklogMobileBar, BacklogPageMenu, BacklogViewSeg } from './BacklogBar';
import { RemainingMeter } from './RemainingMeter';
import { BacklogRow, type RowMenuItem } from './BacklogRow';
import {
  BACKLOG_PAGE, backlogToApi, backlogToUrl, hasBacklogFilters, needsHours, moveBetweenLists, parseBacklogFilters, resetBacklogFilters, serviceToApi, shelvedToApi,
  type BacklogFilters as Filters,
} from './backlog';
import { GameCard, type GameActions } from './GameCard';
import { HltbStatus, useHltbRunner } from './HltbRunner';
import { useIsMobile } from '../primitives/hooks';
import { useBacklogView } from './useBacklogView';
import { useOpenGameFromPage } from './useGameLink';
import { useFocusRescue } from '../primitives/useFocusRescue';
import { LoaderOverlay } from '../loader/LoaderOverlay';
import { CardGridSkeleton } from '../skeletons';
import { GameGrid, GameGridItem } from './GameGrid';

// Панель поиска грузится лениво: до первого нажатия «Добавить» её кода на странице нет (Фаза 43)
/** Предельное ожидание второстепенных запросов Бэклога до показа списка (мс). */
const SKELETON_MAX_MS = 5000;
const AddFromStoreSheet = dynamic(() => import('./AddFromStoreSheet').then((m) => m.AddFromStoreSheet), { ssr: false });

/** Страница «Бэклог»: игры со статусом backlog, быстрые действия «Начать играть» и «Убрать из бэклога». */
export function BacklogView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlKey = params.toString();
  // Источник правды для запросов: локальное состояние (мгновенно, без гонок при быстрых кликах); адрес только отражает его.
  // Внешняя навигация (назад/вперёд) определяется по ключам адреса, которые мы сами не записывали.
  const [filters, setFiltersState] = useState<Filters>(() => parseBacklogFilters(params));
  const filtersRef = useRef(filters);
  const pendingRef = useRef<Set<string>>(new Set());
  const filtersKey = backlogToUrl(filters).toString();
  useEffect(() => {
    const incoming = backlogToUrl(parseBacklogFilters(new URLSearchParams(urlKey))).toString();
    if (pendingRef.current.delete(incoming) || incoming === backlogToUrl(filtersRef.current).toString()) return;
    const next = parseBacklogFilters(new URLSearchParams(urlKey));
    filtersRef.current = next;
    setFiltersState(next);
  }, [urlKey]);
  const toast = useToast();
  const [items, setItems] = useState<GameItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<DurationCounts | null>(null);
  const [genreCounts, setGenreCounts] = useState<GenreCounts | null>(null);
  const [hltbCounts, setHltbCounts] = useState<HltbCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const reqRef = useRef(0);
  const [error, setError] = useState(false);
  const [more, setMore] = useState(false);
  const itemsRef = useRef<GameItem[] | null>(null);
  useEffect(() => { itemsRef.current = items; }, [items]);
  // записи «не куплено» (Фаза 43): отдельный список manual-games; сбой (в том числе 503 на старой схеме) = пусто, страница работает
  const [manual, setManual] = useState<ManualGame[]>([]);
  const manualRef = useRef<ManualGame[]>([]);
  const [manualReady, setManualReady] = useState(false);
  const [giveUp, setGiveUp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGiveUp(true), SKELETON_MAX_MS);
    return () => clearTimeout(t);
  }, []);
  // чип «Это та игра?» и записи «не куплено» приходят позже списка: до их прихода держим скелетон, чтобы список не сдвигался (QA-43-3)
  const [matchReady, setMatchReady] = useState(false);
  const [auxReady, setAuxReady] = useState({ shelved: false, service: false });
  const onMatchSettled = useCallback(() => setMatchReady(true), []);
  const [today] = useState(() => mskDay(Date.now()));
  const [addOpen, setAddOpen] = useState(false);
  // запрос, с которым открывается панель поиска («Все результаты в магазине PS», Enter при мягком пределе)
  const [addQuery, setAddQuery] = useState<string | undefined>(undefined);
  const [searchOpen, setSearchOpen] = useState(false);
  // секция «Не куплено»: свёрнутость в localStorage, «Показать ещё» без запроса, вкладка не пропадает, если секция уже была в сессии
  const [nbOpen, setNbOpenState] = useState(readNbOpen);
  const [nbShowAll, setNbShowAll] = useState(false);
  const [seenNb, setSeenNb] = useState(false);
  const setNbOpen = useCallback((v: boolean) => { setNbOpenState(v); writeNbOpen(v); }, []);
  const [removing, setRemoving] = useState<ManualGame | null>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const setManualList = useCallback((next: ManualGame[]) => { manualRef.current = next; setManual(next); }, []);
  const loadManual = useCallback(async () => {
    try {
      const r = await fetchManual();
      setManualList(r.items);
    } catch {
      // оставляем последний список
    } finally {
      setManualReady(true);
    }
  }, [setManualList]);
  useEffect(() => {
    const t = setTimeout(() => void loadManual(), 0);
    return () => clearTimeout(t);
  }, [loadManual]);
  // блок «Сервис»: отдельный запрос status=service, фильтры бэклога его не затрагивают
  const [service, setService] = useState<GameItem[] | null>(null);
  const [serviceTotal, setServiceTotal] = useState(0);
  const [serviceOpen, setServiceOpen] = useState(true);
  const serviceRef = useRef<GameItem[] | null>(null);
  useEffect(() => { serviceRef.current = service; }, [service]);
  const serviceReq = useRef(0);
  // блок «Отложено»: отдельный запрос status=shelved
  const [shelved, setShelved] = useState<GameItem[] | null>(null);
  const [shelvedTotal, setShelvedTotal] = useState(0);
  const [shelvedOpen, setShelvedOpen] = useState(true);
  const shelvedRef = useRef<GameItem[] | null>(null);
  useEffect(() => { shelvedRef.current = shelved; }, [shelved]);
  const shelvedReq = useRef(0);
  // вкладка блока не пропадает, если он был виден в этой сессии
  const [seenShelved, setSeenShelved] = useState(false);
  const showShelved = !!shelved && (shelvedTotal > 0 || shelved.length > 0 || seenShelved);
  const showService = !!service && service.length > 0;
  if (!seenShelved && shelved && (shelved.length > 0 || shelvedTotal > 0)) setSeenShelved(true);
  // липкая плашка: сентинел + IntersectionObserver даёт data-stuck, scroll-spy даёт aria-current
  const sentinelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusRescue(rootRef);
  const [stuck, setStuck] = useState(false);
  const [activeTab, setActiveTab] = useState('h-bl-main');
  const spyLock = useRef(false);
  const spyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (spyTimer.current) clearTimeout(spyTimer.current); }, []);
  // прокрутка к заголовку блока: ниже шапки и липкой панели переключателя (высоты меряем, на мобильном они другие)
  const scrollToEl = (el: HTMLElement) => {
    const headerH = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
    const navH = document.querySelector<HTMLElement>('[data-testid="bl-jump"]')?.offsetHeight ?? 0;
    const top = window.scrollY + el.getBoundingClientRect().top - Math.max(0, headerH) - navH - 8;
    window.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    scrollToEl(el);
    el.focus({ preventScroll: true });
    // клик ставит вкладку активной сразу; пока идёт прокрутка, scroll-spy её не перебивает
    setActiveTab(id);
    spyLock.current = true;
    if (spyTimer.current) clearTimeout(spyTimer.current);
    spyTimer.current = setTimeout(() => { spyLock.current = false; }, 900);
  };
  const loadShelved = useCallback(async () => {
    const my = ++shelvedReq.current;
    try {
      const r = await fetchGames(shelvedToApi());
      if (my !== shelvedReq.current) return;
      setShelved(r.items);
      setShelvedTotal(r.total);
    } catch {
      // блок вспомогательный: при ошибке остаётся последний список (или скрыт, если его не было)
    } finally {
      setAuxReady((a) => (a.shelved ? a : { ...a, shelved: true }));
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void loadShelved(), 0);
    return () => clearTimeout(t);
  }, [loadShelved]);
  const loadService = useCallback(async () => {
    const my = ++serviceReq.current;
    try {
      const r = await fetchGames(serviceToApi());
      if (my !== serviceReq.current) return;
      setService(r.items);
      setServiceTotal(r.total);
    } catch {
      // блок вспомогательный: при ошибке остаётся последний список (или скрыт, если его не было)
    } finally {
      setAuxReady((a) => (a.service ? a : { ...a, service: true }));
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void loadService(), 0);
    return () => clearTimeout(t);
  }, [loadService]);

  const load = useCallback(async () => {
    const my = ++reqRef.current;
    setError(false);
    setLoading(true);
    try {
      const nb = filtersRef.current.nb;
      // «Не куплено»: игры библиотеки не показываем (контракт 43.2), запрос нужен только за счётчиками фильтров
      const r = await fetchGames(backlogToApi(filtersRef.current, { limit: nb ? 1 : BACKLOG_PAGE, offset: 0 }));
      if (my !== reqRef.current) return;
      setItems(nb ? [] : r.items);
      setTotal(nb ? 0 : r.total);
      setCounts(r.durationCounts ?? null);
      setGenreCounts(r.genreCounts ?? null);
      setHltbCounts(r.hltbCounts ?? null);
    } catch (e) {
      if (my !== reqRef.current) return;
      if (e instanceof ApiError && e.status === 401) return;
      // список уже на экране: оставляем его и сообщаем об ошибке тостом
      if (itemsRef.current) toast({ kind: 'error', text: `Не удалось обновить список. ${errorText(e)}` });
      else setError(true);
    } finally {
      if (my === reqRef.current) setLoading(false);
    }
  }, [toast]);

  // перезагрузка при смене фильтров (старый список остаётся на экране, пока идёт запрос)
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, filtersKey]);

  const setFilters = useCallback((p: Partial<Filters>) => {
    const next = { ...filtersRef.current, ...p };
    filtersRef.current = next;
    setFiltersState(next);
    const qs = backlogToUrl(next).toString();
    pendingRef.current.add(qs);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router]);

  async function loadMore() {
    const have = itemsRef.current ?? [];
    setMore(true);
    try {
      const r = await fetchGames(backlogToApi(filtersRef.current, { limit: BACKLOG_PAGE, offset: have.length }));
      const ids = new Set(have.map((g) => g.id));
      setItems([...have, ...r.items.filter((g) => !ids.has(g.id))]);
      setTotal(r.total);
    } catch (e) {
      toast({ kind: 'error', text: `Не удалось загрузить ещё. ${errorText(e)}` });
    } finally {
      setMore(false);
    }
  }

  const [moreShelved, setMoreShelved] = useState(false);
  async function loadMoreShelved() {
    const have = shelvedRef.current ?? [];
    setMoreShelved(true);
    try {
      const r = await fetchGames(shelvedToApi(BACKLOG_PAGE, have.length));
      const ids = new Set(have.map((g) => g.id));
      const next = [...have, ...r.items.filter((g) => !ids.has(g.id))];
      shelvedRef.current = next;
      setShelved(next);
      setShelvedTotal(r.total);
    } catch (e) {
      toast({ kind: 'error', text: `Не удалось загрузить ещё. ${errorText(e)}` });
    } finally {
      setMoreShelved(false);
    }
  }

  const change = useCallback(async (game: GameItem, status: GameStatusValue | null) => {
    if (game.status === status) return;
    // игра переезжает между блоками сразу; при ошибке возвращается на место
    const beforeB = itemsRef.current ?? [];
    const beforeS = serviceRef.current ?? [];
    const beforeH = shelvedRef.current ?? [];
    const apply = (g: GameItem, to: GameStatusValue | null) => {
      const r = moveBetweenLists({ backlog: itemsRef.current ?? [], service: serviceRef.current ?? [], shelved: shelvedRef.current ?? [] }, g, to);
      itemsRef.current = r.lists.backlog;
      serviceRef.current = r.lists.service;
      shelvedRef.current = r.lists.shelved;
      setItems(r.lists.backlog);
      setService(r.lists.service);
      setShelved(r.lists.shelved);
      setShelvedTotal((n) => Math.max(0, n + r.shelvedDelta));
      setTotal((n) => Math.max(0, n + r.backlogDelta));
      setServiceTotal((n) => Math.max(0, n + r.serviceDelta));
    };
    const sync = () => { void load(); void loadService(); void loadShelved(); };
    apply(game, status);
    try {
      await putStatus(game.id, status);
      sync();
      toast({
        text: `Статус изменён: ${STATUS_META[status ?? 'none'].label}`,
        action: { label: 'Отменить', run: () => void restore(game) },
      });
    } catch (e) {
      itemsRef.current = beforeB;
      serviceRef.current = beforeS;
      shelvedRef.current = beforeH;
      setItems(beforeB);
      setService(beforeS);
      setShelved(beforeH);
      void load();
      void loadService();
      void loadShelved();
      toast({ kind: 'error', text: `Не удалось сменить статус. ${errorText(e)}` });
    }
    async function restore(g: GameItem) {
      try {
        await putStatus(g.id, g.status);
        apply({ ...g, status }, g.status);
        sync();
        toast({ text: 'Статус возвращён' });
      } catch (e) {
        toast({ kind: 'error', text: `Не удалось вернуть статус. ${errorText(e)}` });
      }
    }
  }, [load, loadService, loadShelved, toast]);

  const openGameLink = useOpenGameFromPage();
  const actions: GameActions = useMemo(() => ({
    open: (g) => openGameLink(g.id),
    setStatus: (g, s) => void change(g, s),
    toggle: () => {},
  }), [change, openGameLink]);

  const [view, setView] = useBacklogView();
  const mobile = useIsMobile();
  const hltb = useHltbRunner(() => void load());
  const startHltb = hltb.start;
  const menuFor = (g: GameItem, kind: 'backlog' | 'shelved' | 'service'): RowMenuItem[] => [
    ...(kind !== 'service' && needsHours(g) ? [{ label: 'Указать часы', run: () => actions.open(g) }] : []),
    { label: 'Открыть игру', run: () => actions.open(g) },
    ...(kind === 'backlog' ? [{ label: 'В сервис', run: () => void change(g, 'service') }, { label: 'Убрать из бэклога', run: () => void change(g, null) }] : []),
    ...(kind === 'shelved' ? [{ label: 'Вернуть в бэклог', run: () => void change(g, 'backlog') }] : []),
    ...(kind === 'service' ? [{ label: 'Вернуть в бэклог', run: () => void change(g, 'backlog') }, { label: 'Убрать из сервиса', run: () => void change(g, null) }] : []),
  ];
  // ---------- записи «не куплено» (Фаза 43) ----------
  async function undoBought(g: ManualGame) {
    setManualList(setNotPurchased(manualRef.current, g.id, true));
    try {
      await unmarkPurchased(g.id);
    } catch (e) {
      if (isGoneOrDone(e)) { void loadManual(); return; }
      setManualList(setNotPurchased(manualRef.current, g.id, false));
      toast({ kind: 'error', text: manualErrorText(e, 'Не удалось вернуть пометку. Повтори.') });
    }
  }
  // запись переезжает из секции в основной список: фокус возвращаем на «…» уже на новом месте (старая кнопка размонтирована)
  function focusManualMore(id: number) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      (document.querySelector<HTMLElement>(`[data-manual="${id}"] .ps-nbmore`) ?? document.getElementById('h-bl-nb') ?? document.getElementById('h-bl-main'))?.focus();
    }));
  }
  async function bought(g: ManualGame, restoreFocus: () => void) {
    setManualList(setNotPurchased(manualRef.current, g.id, false));
    focusManualMore(g.id);
    try {
      await markPurchased(g.id);
    } catch (e) {
      // уже склеена с игрой библиотеки или убрана: список перезагружаем, ошибки нет
      if (isGoneOrDone(e)) { void loadManual(); return; }
      setManualList(setNotPurchased(manualRef.current, g.id, true));
      toast({ kind: 'error', text: manualErrorText(e, 'Не удалось снять пометку. Повтори.'), action: { label: 'Повторить', run: () => void bought(g, restoreFocus) } });
      return;
    }
    toast({ text: `Пометка снята: «${truncate(g.title)}»`, ttl: 8000, action: { label: 'Отменить', run: () => void undoBought(g) } });
  }
  async function confirmRemove(g: ManualGame) {
    const all = Array.from(document.querySelectorAll<HTMLElement>('[data-manual]'));
    const at = all.findIndex((el) => el.dataset.manual === String(g.id));
    const neighbour = at >= 0 ? (all[at + 1] ?? all[at - 1]) : undefined;
    await removeManual(g.id);
    setManualList(removeManualById(manualRef.current, g.id));
    setRemoving(null);
    toast({ text: `Убрано из бэклога: «${truncate(g.title)}»` });
    requestAnimationFrame(() => {
      const next = neighbour?.dataset.manual ? document.querySelector<HTMLElement>(`[data-manual="${neighbour.dataset.manual}"] .ps-nbmore`) : null;
      (next ?? document.getElementById(nbAll.length > 1 ? 'h-bl-nb' : 'h-bl-main'))?.focus();
    });
  }
  const manualHandlers: ManualHandlers = { bought: (g, f) => void bought(g, f), remove: (g) => setRemoving(g) };
  function openAdd(query?: string) {
    addBtnRef.current?.focus();
    setAddQuery(query);
    setAddOpen(true);
  }
  // «Показать» в тосте: к секции «Не куплено» (после обновления списка записей)
  async function showNb() {
    await loadManual();
    setNbOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => jumpTo('h-bl-nb')));
  }
  function addedToast(added: readonly AddedItem[]) {
    void loadManual();
    const fresh = added.filter((a) => !a.marked);
    const marked = added.length - fresh.length;
    const text = fresh.length === 0
      ? (marked === 1 ? `Отмечено «Купил»: «${truncate(added[0].title)}»` : `Отмечено «Купил»: ${marked}`)
      : addedSummaryText(fresh) + (marked > 0 ? `; отмечено «Купил»: ${marked}` : '');
    toast({ text, ttl: 6000, action: hasNotPurchased(fresh) ? { label: 'Показать', run: () => void showNb() } : undefined });
  }
  function closeAdd(added: AddedItem[]) {
    setAddOpen(false);
    setAddQuery(undefined);
    if (added.length > 0) addedToast(added);
  }

  // ---------- поиск по списку (Фаза 43.1) ----------
  function revealAndFocus(el: HTMLElement, target: HTMLElement | null) {
    scrollToEl(el);
    (target ?? el).focus({ preventScroll: true });
  }
  function focusPicked(p: SearchPick, stage = 0) {
    if (p.kind === 'game') {
      const el = document.querySelector<HTMLElement>(`[data-game="${p.game.id}"]`);
      // игра ещё не загружена в список («Показать ещё»): сужаем список по её названию
      if (!el) { setFilters({ q: p.game.title }); return; }
      revealAndFocus(el, el.querySelector<HTMLElement>('.ps-card__hit, .ps-blrow__hit'));
      return;
    }
    const m = p.item;
    if (m.notPurchased && stage === 0) {
      // свёрнутая секция раскрывается, скрытые «Показать ещё» записи показываются
      setNbOpen(true);
      setNbShowAll(true);
      setTimeout(() => focusPicked(p, 1), 60);
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-manual="${m.id}"]`);
    if (!el) { setFilters({ q: m.title }); return; }
    revealAndFocus(el, el.querySelector<HTMLElement>('[data-testid="np-bought"]') ?? el.querySelector<HTMLElement>('.ps-nbmore'));
  }
  // лист закрывается и возвращает фокус на иконку: переход к игре делаем после этого
  const onSearchPick = (p: SearchPick) => { requestAnimationFrame(() => requestAnimationFrame(() => focusPicked(p))); };

  const nbAll = manual.filter((g) => g.notPurchased);
  const shownManual = visibleManual(manual, filters);
  const nbShown = shownManual.filter((g) => g.notPurchased);
  const boughtShown = shownManual.filter((g) => !g.notPurchased);
  const nbCount = countNotPurchased(manual);
  if (!seenNb && nbAll.length > 0) setSeenNb(true);
  // секция показывается, если в ней есть записи под фильтры; пустой (все куплены) остаётся «Всё куплено», если записи в ней уже были
  const showNbSection = nbShown.length > 0 || (seenNb && nbAll.length === 0);
  // записи «Купил» без данных идут после игр; пока подгружаются не все игры, в конец не ставим (иначе встанут посреди списка)
  const manualPart = filters.sort === 'title' || !items || items.length >= total ? boughtShown : [];
  const entries = items && !filters.nb ? mergeBacklog(items, manualPart, filters.sort, filters.order) : [];
  const shownTotal = total + shownManual.length;
  const mainTotal = filters.nb ? 0 : total + boughtShown.length;

  const backlogCard = (g: GameItem) => (
    <GameCard game={g} actions={actions} selectMode={false} selected={false}>
      <RemainingMeter duration={g.duration} playedSeconds={g.playSeconds} variant="card" />
      {needsHours(g) && <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm ps-rem__act" onClick={() => actions.open(g)}>Указать часы</button>}
      <div className="ps-bl-actions">
        <button type="button" className="ps-btn ps-btn--primary ps-btn--sm" onClick={() => void change(g, 'playing')}>
          <StatusGlyph status="playing" size={14} />Начать играть
        </button>
        <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => void change(g, 'service')}>
          <StatusGlyph status="service" size={14} />В сервис
        </button>
        <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => void change(g, null)}>Убрать из бэклога</button>
      </div>
    </GameCard>
  );
  const rows = (list: GameItem[], kind: 'backlog' | 'shelved' | 'service', label: string) => (
    <ul className="ps-bl-rows" aria-label={label}>
      {list.map((g) => (
        <BacklogRow key={g.id} game={g} hideBar={kind === 'service'} onOpen={() => actions.open(g)} onPlay={() => void change(g, 'playing')} menu={menuFor(g, kind)} />
      ))}
    </ul>
  );

  // список готов: секции «Не куплено» и остальные блоки показываем только вместе со списком (скелет не даёт им прыгать, QA-43-3)
  // QA-43.1-7: зависший второстепенный запрос не держит скелет дольше SKELETON_MAX_MS, показываем то, что уже пришло
  const auxDone = giveUp || (manualReady && matchReady && auxReady.shelved && auxReady.service);
  const ready = !!items && !(error && !items) && auxDone;
  const tabs = [
    { id: 'h-bl-main', label: 'Бэклог', n: mainTotal, on: !filters.nb },
    { id: 'h-bl-nb', label: 'Не куплено', n: nbShown.length, on: showNbSection },
    { id: 'h-bl-shelved', label: 'Отложено', n: shelvedTotal, on: showShelved },
    { id: 'h-bl-service', label: 'Сервис', n: serviceTotal, on: showService },
  ].filter((t) => t.on);
  const showJump = tabs.length >= 2;
  const tabIds = tabs.map((t) => t.id).join(',');

  useEffect(() => {
    if (!showJump) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 56;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { rootMargin: `-${h}px 0px 0px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [showJump]);

  useEffect(() => {
    if (!showJump) return;
    const ids = tabIds.split(',');
    const onScroll = () => {
      if (spyLock.current) return;
      const headerH = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
      const navH = document.querySelector<HTMLElement>('[data-testid="bl-jump"]')?.offsetHeight ?? 0;
      const line = Math.max(0, headerH) + navH + 16;
      let cur = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) cur = id;
      }
      if (window.scrollY <= 0) cur = ids[0];
      setActiveTab(cur);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const onEnd = () => { spyLock.current = false; onScroll(); };
    window.addEventListener('scrollend', onEnd);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); window.removeEventListener('scrollend', onEnd); };
  }, [showJump, tabIds]);

  return (
    <>
    <LoaderOverlay loading={loading && !error} blocking={!items} contentRef={rootRef} />
    <div ref={rootRef} className="ps-collection" data-tour-page="backlog" data-tour-ready={String(!!items || error)}>
      <div className="ps-pagehead ps-bl-pagehead">
        <h1 className="ps-h1">Бэклог</h1>
        {items && shownTotal > 0 ? <p className="ps-statline ps-num"><b>{formatNumber(shownTotal)}</b> в списке</p> : !items && !error && <span className="ps-skeleton ps-sk-stat120" aria-hidden="true" />}
        <div className="ps-bl-pagehead__tools">
          <button
            ref={addBtnRef} type="button" className={mobile ? 'ps-btn ps-nb-add' : 'ps-btn ps-btn--primary ps-nb-add'} data-testid="bl-add"
            aria-haspopup="dialog" aria-label="Добавить из магазина PS" onClick={() => openAdd()}
          >
            <Icon name="plus" size={16} />{mobile ? 'Добавить' : 'Добавить из магазина PS'}
          </button>
          {!mobile && (items || counts) && <BacklogViewSeg view={view} onView={setView} />}
          <BacklogPageMenu running={hltb.running} onHltb={(recheck) => void startHltb(recheck)} onAdd={() => openAdd()} />
        </div>
      </div>
      {/* поле поиска на десктопе: строка между шапкой и фильтрами; CSS прячет её на < 768, чтобы первый кадр не прыгал */}
      {!mobile && (
        <div className="ps-bs-row">
          <BacklogSearch
            variant="inline" manual={manual} appliedQ={filters.q} onApply={(q) => setFilters({ q })} onPick={onSearchPick}
            onAdded={(title) => addedToast([{ title, bought: false }])} onOpenStore={(q) => openAdd(q)}
          />
        </div>
      )}
      {!(items || counts) && !error && <div className="ps-skeleton ps-sk-blfilters" aria-hidden="true" />}
      {(items || counts) && (mobile ? (
        <BacklogMobileBar
          filters={filters} counts={counts} genreCounts={genreCounts} hltbCounts={hltbCounts} total={shownTotal} nbCount={nbCount} view={view} onView={setView}
          onChange={setFilters} onReset={() => setFilters(resetBacklogFilters(filters))} onSearch={() => setSearchOpen(true)}
        />
      ) : (
        <BacklogFilters filters={filters} counts={counts} genreCounts={genreCounts} hltbCounts={hltbCounts} nbCount={nbCount} onChange={setFilters} onReset={() => setFilters(resetBacklogFilters(filters))} />
      ))}
      {mobile && filters.q && (
        <div className="ps-bs-active" data-testid="bs-active">
          <span className="ps-bs-active__t">Поиск: «{filters.q}»</span>
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => setFilters({ q: '' })}>Сбросить</button>
        </div>
      )}
      <HltbStatus runner={hltb} />
      {showJump && (
        <>
          <div className="ps-bl-jump__sentinel" ref={sentinelRef} aria-hidden="true" />
          <nav className="ps-bl-jump" aria-label="Блоки страницы" data-testid="bl-jump" data-stuck={stuck ? 'true' : 'false'}>
            <div className="ps-bl-jump__tabs">
              {tabs.map((t) => (
                <button key={t.id} type="button" className="ps-bl-jump__tab" aria-current={activeTab === t.id ? 'location' : undefined} onClick={() => jumpTo(t.id)}>
                  {t.label} <b className="num">{formatNumber(t.n)}</b>
                </button>
              ))}
            </div>
          </nav>
        </>
      )}
      {(items || !error) && !filters.nb && (
        <h2 className="ps-h2 ps-h2--icon ps-bl-h" id="h-bl-main" tabIndex={-1} data-testid="bl-main-head">
          <StatusGlyph status="backlog" size={16} />Бэклог {items && <small className="num ps-bl-service__n" data-testid="bl-main-count">{formatNumber(mainTotal)}</small>}
        </h2>
      )}
      {/* чип под заголовком: появляясь вместе со списком, он не сдвигает заголовок и блоки выше (QA-43-3) */}
      <MatchChip className="ps-bl-match" hold={!items || !auxDone} onSettled={onMatchSettled} onChanged={() => { void loadManual(); void load(); }} />
      {error && !items ? (
        <EmptyState icon="circle-alert" role="alert" title="Что-то пошло не так" text="Не удалось загрузить бэклог. Попробуй обновить страницу.">
          <button type="button" className="ps-btn ps-btn--primary" onClick={() => void load()}>Обновить</button>
        </EmptyState>
      ) : !items || !auxDone ? (
        <div key="sk" aria-busy="true"><span role="status" className="ps-sr">Загрузка…</span><CardGridSkeleton /></div>
      ) : filters.nb && nbShown.length > 0 ? null : entries.length === 0 && nbShown.length === 0 && hasBacklogFilters(filters) ? (
        <EmptyState icon="search" title="Ничего не найдено" text={filters.q ? `По запросу «${filters.q}» в бэклоге ничего нет.` : 'В бэклоге нет игр под выбранные фильтры.'}>
          <button type="button" className="ps-btn ps-btn--primary" onClick={() => setFilters(resetBacklogFilters(filters))}>Сбросить фильтры</button>
        </EmptyState>
      ) : entries.length === 0 && (nbShown.length > 0 || nbAll.length > 0 || showNbSection) && hasBacklogFilters(filters) ? (
        <p className="ps-bl-service__sub" data-testid="bl-main-none">В основном списке ничего нет под выбранные фильтры.</p>
      ) : entries.length === 0 && nbShown.length === 0 ? (
        <EmptyState icon={<StatusGlyph status="backlog" size={40} />} title="Бэклог пуст" text="Поставь играм статус «Бэклог» в коллекции или добавь игру из магазина PS">
          <Link href="/" className="ps-btn ps-btn--primary">К коллекции</Link>
          <button type="button" className="ps-btn ps-btn--primary" data-testid="bl-add-empty" aria-haspopup="dialog" onClick={() => openAdd()}>
            <Icon name="plus" size={16} />Добавить из магазина PS
          </button>
        </EmptyState>
      ) : (
        <div key="list" className="ps-bl-list" data-tour="backlog-list" data-view={view} aria-busy={loading || undefined} data-loading={loading || undefined}>
        {view === 'list' ? (
          <ul className="ps-bl-rows" aria-label="Игры в бэклоге">
            {entries.map((e) => (e.manual
              ? <ManualRow key={`m${e.manual.id}`} game={e.manual} handlers={manualHandlers} today={today} />
              : <BacklogRow key={e.game!.id} game={e.game!} onOpen={() => actions.open(e.game!)} onPlay={() => void change(e.game!, 'playing')} menu={menuFor(e.game!, 'backlog')} />))}
          </ul>
        ) : (
        <GameGrid density="comfort" label="Игры в бэклоге">
          {entries.map((e) => (e.manual
            ? <GameGridItem key={`m${e.manual.id}`}><ManualCard game={e.manual} handlers={manualHandlers} today={today} /></GameGridItem>
            : <GameGridItem key={e.game!.id}>{backlogCard(e.game!)}</GameGridItem>))}
        </GameGrid>
        )}
        </div>
      )}
      {items && !filters.nb && items.length > 0 && items.length < total && (
        <div className="ps-more">
          <button type="button" className="ps-btn" onClick={() => void loadMore()} disabled={more}>
            {more ? 'Загрузка…' : `Показать ещё (${formatNumber(total - items.length)})`}
          </button>
        </div>
      )}
      {ready && showNbSection && (
        <NotPurchasedSection
          items={nbShown} view={view} open={nbOpen} onToggle={() => setNbOpen(!nbOpen)} showAll={nbShowAll} onShowAll={() => setNbShowAll(true)}
          handlers={manualHandlers} today={today}
        />
      )}
      {showShelved && shelved && (
        <section className="ps-bl-service" id="shelved" aria-labelledby="h-bl-shelved" data-testid="bl-shelved">
          <div className="ps-bl-service__head">
            <h2 className="ps-h2 ps-h2--icon ps-bl-h" id="h-bl-shelved" tabIndex={-1}>
              <StatusGlyph status="shelved" size={16} />Отложено <small className="num ps-bl-service__n" data-testid="bl-shelved-count">{formatNumber(shelvedTotal)}</small>
            </h2>
            <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" aria-expanded={shelvedOpen} aria-controls="bl-shelved-list" onClick={() => setShelvedOpen((v) => !v)}>
              <Icon name={shelvedOpen ? 'chevron-up' : 'chevron-down'} size={14} />{shelvedOpen ? 'Свернуть' : 'Развернуть'}
            </button>
          </div>
          <p className="ps-bl-service__sub">Отложено на потом. В бэклог и план эти игры не входят.</p>
          {shelvedOpen && (
            <div id="bl-shelved-list">
              {shelved.length === 0 ? (
                <EmptyState icon={<StatusGlyph status="shelved" size={40} />} title="Отложенных игр нет" text="Поставь игре статус «Отложено» в меню карточки, и она появится здесь." />
              ) : view === 'list' ? rows(shelved, 'shelved', 'Отложенные игры') : (
                <GameGrid density="comfort" label="Отложенные игры">
                  {shelved.map((g) => (
                    <GameGridItem key={g.id}>
                      <GameCard game={g} actions={actions} selectMode={false} selected={false}>
                        <RemainingMeter duration={g.duration} playedSeconds={g.playSeconds} variant="card" />
                        {needsHours(g) && <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm ps-rem__act" onClick={() => actions.open(g)}>Указать часы</button>}
                        <div className="ps-bl-actions">
                          <button type="button" className="ps-btn ps-btn--primary ps-btn--sm" onClick={() => void change(g, 'backlog')}>
                            <StatusGlyph status="backlog" size={14} />Вернуть в бэклог
                          </button>
                          <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => void change(g, 'playing')}>
                            <StatusGlyph status="playing" size={14} />Начать играть
                          </button>
                        </div>
                      </GameCard>
                    </GameGridItem>
                  ))}
                </GameGrid>
              )}
              {shelved.length > 0 && shelved.length < shelvedTotal && (
                <div className="ps-more">
                  <button type="button" className="ps-btn" data-testid="bl-shelved-more" onClick={() => void loadMoreShelved()} disabled={moreShelved}>
                    {moreShelved ? 'Загрузка…' : `Показать ещё (${formatNumber(shelvedTotal - shelved.length)})`}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
      {showService && service && (
        <section className="ps-bl-service" id="service" aria-labelledby="h-bl-service" data-testid="bl-service">
          <div className="ps-bl-service__head">
            <h2 className="ps-h2 ps-h2--icon ps-bl-h" id="h-bl-service" tabIndex={-1}>
              <StatusGlyph status="service" size={16} />Сервис <small className="num ps-bl-service__n" data-testid="bl-service-count">{formatNumber(serviceTotal)}</small>
            </h2>
            <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" aria-expanded={serviceOpen} aria-controls="bl-service-list" onClick={() => setServiceOpen((v) => !v)}>
              <Icon name={serviceOpen ? 'chevron-up' : 'chevron-down'} size={14} />{serviceOpen ? 'Свернуть' : 'Развернуть'}
            </button>
          </div>
          <p className="ps-bl-service__sub">Игры-сервисы не попадают в план прохождения.</p>
          {serviceOpen && (
            <div id="bl-service-list">
              {view === 'list' ? rows(service, 'service', 'Игры-сервисы') : (
              <GameGrid density="comfort" label="Игры-сервисы">
                {service.map((g) => (
                  <GameGridItem key={g.id}>
                    <GameCard game={g} actions={actions} selectMode={false} selected={false}>
                      <div className="ps-bl-actions">
                        <button type="button" className="ps-btn ps-btn--primary ps-btn--sm" onClick={() => void change(g, 'backlog')}>
                          <StatusGlyph status="backlog" size={14} />Вернуть в бэклог
                        </button>
                        <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => void change(g, null)}>Убрать из сервиса</button>
                      </div>
                    </GameCard>
                  </GameGridItem>
                ))}
              </GameGrid>
              )}
            </div>
          )}
        </section>
      )}
      {mobile && searchOpen && (
        <Sheet open onClose={() => setSearchOpen(false)} title="Поиск" className="ps-bs-sheet" initialFocus="[data-testid='bs-input']">
          <div className="ps-bs-sheet__body">
            <BacklogSearch
              variant="sheet" manual={manual} appliedQ={filters.q} onApply={(q) => setFilters({ q })} onPick={onSearchPick}
              onAdded={(title) => addedToast([{ title, bought: false }])} onOpenStore={(q) => openAdd(q)} onDone={() => setSearchOpen(false)}
            />
          </div>
          <div className="ps-add__foot ps-bs-sheet__foot">
            <p className="ps-rec-note">
              <span>Данные об играх:</span>
              <a className="ps-rec-note__link" href="https://rawg.io" target="_blank" rel="noopener noreferrer" aria-label="RAWG (новая вкладка)">RAWG<Icon name="external-link" size={12} /></a>
            </p>
            <button type="button" className="ps-btn ps-btn--ghost" onClick={() => setSearchOpen(false)}>Закрыть</button>
          </div>
        </Sheet>
      )}
      <RemoveManualSheet game={removing} onClose={() => setRemoving(null)} onConfirm={confirmRemove} />
      {addOpen && <AddFromStoreSheet onClose={closeAdd} initialQuery={addQuery} />}
    </div>
    </>
  );
}
