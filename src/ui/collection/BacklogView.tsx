'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DurationCounts, GameItem, GenreCounts, GameStatusValue, HltbCounts } from '@/server/collection/types';
import '../backlog.css';
import { EmptyState } from '../EmptyState';
import { formatNumber } from '../format';
import { Icon, StatusGlyph } from '../icons';
import { useToast } from '../primitives/Toast';
import { STATUS_META } from '../tokens';
import { ApiError, errorText, fetchGames, putStatus } from './api';
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
import { LoaderOverlay } from '../loader/LoaderOverlay';
import { CardGridSkeleton } from '../skeletons';
import { GameGrid, GameGridItem } from './GameGrid';

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
  const [stuck, setStuck] = useState(false);
  const [activeTab, setActiveTab] = useState('h-bl-main');
  const spyLock = useRef(false);
  const spyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (spyTimer.current) clearTimeout(spyTimer.current); }, []);
  // прокрутка к заголовку блока: ниже шапки и липкой панели переключателя (высоты меряем, на мобильном они другие)
  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const headerH = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
    const navH = document.querySelector<HTMLElement>('[data-testid="bl-jump"]')?.offsetHeight ?? 0;
    const top = window.scrollY + el.getBoundingClientRect().top - Math.max(0, headerH) - navH - 8;
    window.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
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
      const r = await fetchGames(backlogToApi(filtersRef.current, { limit: BACKLOG_PAGE, offset: 0 }));
      if (my !== reqRef.current) return;
      setItems(r.items);
      setTotal(r.total);
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
  const rows = (list: GameItem[], kind: 'backlog' | 'shelved' | 'service', label: string) => (
    <ul className="ps-bl-rows" aria-label={label}>
      {list.map((g) => (
        <BacklogRow key={g.id} game={g} hideBar={kind === 'service'} onOpen={() => actions.open(g)} onPlay={() => void change(g, 'playing')} menu={menuFor(g, kind)} />
      ))}
    </ul>
  );

  const tabs = [
    { id: 'h-bl-main', label: 'Бэклог', n: total, on: true },
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
        {items && items.length > 0 ? <p className="ps-statline ps-num"><b>{formatNumber(total)}</b> в списке</p> : !items && !error && <span className="ps-skeleton ps-sk-stat120" aria-hidden="true" />}
        <div className="ps-bl-pagehead__tools">
          {!mobile && (items || counts) && <BacklogViewSeg view={view} onView={setView} />}
          <BacklogPageMenu running={hltb.running} onHltb={(recheck) => void startHltb(recheck)} />
        </div>
      </div>
      {!(items || counts) && !error && <div className="ps-skeleton ps-sk-blfilters" aria-hidden="true" />}
      {(items || counts) && (mobile ? (
        <BacklogMobileBar
          filters={filters} counts={counts} genreCounts={genreCounts} hltbCounts={hltbCounts} total={total} view={view} onView={setView}
          onChange={setFilters} onReset={() => setFilters(resetBacklogFilters(filters))}
        />
      ) : (
        <BacklogFilters filters={filters} counts={counts} genreCounts={genreCounts} hltbCounts={hltbCounts} onChange={setFilters} onReset={() => setFilters(resetBacklogFilters(filters))} />
      ))}
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
      {(items || !error) && (
        <h2 className="ps-h2 ps-h2--icon ps-bl-h" id="h-bl-main" tabIndex={-1} data-testid="bl-main-head">
          <StatusGlyph status="backlog" size={16} />Бэклог {items && <small className="num ps-bl-service__n" data-testid="bl-main-count">{formatNumber(total)}</small>}
        </h2>
      )}
      {error && !items ? (
        <EmptyState icon="circle-alert" role="alert" title="Что-то пошло не так" text="Не удалось загрузить бэклог. Попробуй обновить страницу.">
          <button type="button" className="ps-btn ps-btn--primary" onClick={() => void load()}>Обновить</button>
        </EmptyState>
      ) : !items ? (
        <div aria-busy="true"><span role="status" className="ps-sr">Загрузка…</span><CardGridSkeleton /></div>
      ) : items.length === 0 && hasBacklogFilters(filters) ? (
        <EmptyState icon="search" title="Ничего не найдено" text="В бэклоге нет игр под выбранные фильтры.">
          <button type="button" className="ps-btn ps-btn--primary" onClick={() => setFilters(resetBacklogFilters(filters))}>Сбросить фильтры</button>
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState icon={<StatusGlyph status="backlog" size={40} />} title="Бэклог пуст" text="Поставь играм статус «Бэклог» в коллекции">
          <Link href="/" className="ps-btn ps-btn--primary">К коллекции</Link>
        </EmptyState>
      ) : (
        <div className="ps-bl-list" data-tour="backlog-list" data-view={view} aria-busy={loading || undefined} data-loading={loading || undefined}>
        {view === 'list' ? rows(items, 'backlog', 'Игры в бэклоге') : (
        <GameGrid density="comfort" label="Игры в бэклоге">
          {items.map((g) => (
            <GameGridItem key={g.id}>
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
            </GameGridItem>
          ))}
        </GameGrid>
        )}
        </div>
      )}
      {items && items.length > 0 && items.length < total && (
        <div className="ps-more">
          <button type="button" className="ps-btn" onClick={() => void loadMore()} disabled={more}>
            {more ? 'Загрузка…' : `Показать ещё (${formatNumber(total - items.length)})`}
          </button>
        </div>
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
    </div>
    </>
  );
}
