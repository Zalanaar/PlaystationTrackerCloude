'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DurationCounts, GameItem, GenreCounts, GameStatusValue, HltbCounts } from '@/server/collection/types';
import '../backlog.css';
import { EmptyState } from '../EmptyState';
import { formatNumber } from '../format';
import { Icon, StatusGlyph } from '../icons';
import { useNow } from '../primitives/hooks';
import { useToast } from '../primitives/Toast';
import { STATUS_META } from '../tokens';
import { ApiError, errorText, fetchGames, putStatus } from './api';
import { BacklogFilters } from './BacklogFilters';
import {
  BACKLOG_PAGE, backlogToApi, backlogToUrl, durationText, hasBacklogFilters, isNotOnHltb, moveBetweenLists, parseBacklogFilters, resetBacklogFilters, serviceToApi, sourceLabel,
  type BacklogFilters as Filters,
} from './backlog';
import { GameCard, type GameActions } from './GameCard';
import { HltbRunner } from './HltbRunner';
import { GameDialog } from './GameDialog';
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
  const now = useNow();
  const [items, setItems] = useState<GameItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<DurationCounts | null>(null);
  const [genreCounts, setGenreCounts] = useState<GenreCounts | null>(null);
  const [hltbCounts, setHltbCounts] = useState<HltbCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const reqRef = useRef(0);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<GameItem | null>(null);
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
  // прокрутка к заголовку блока: ниже шапки и липкой панели переключателя (высоты меряем, на мобильном они другие)
  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const headerH = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
    const navH = document.querySelector<HTMLElement>('[data-testid="bl-jump"]')?.offsetHeight ?? 0;
    const top = window.scrollY + el.getBoundingClientRect().top - Math.max(0, headerH) - navH - 8;
    window.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  };
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
    const apply = (g: GameItem, to: GameStatusValue | null) => {
      const r = moveBetweenLists({ backlog: itemsRef.current ?? [], service: serviceRef.current ?? [] }, g, to);
      itemsRef.current = r.lists.backlog;
      serviceRef.current = r.lists.service;
      setItems(r.lists.backlog);
      setService(r.lists.service);
      setTotal((n) => Math.max(0, n + r.backlogDelta));
      setServiceTotal((n) => Math.max(0, n + r.serviceDelta));
    };
    const sync = () => { void load(); void loadService(); };
    apply(game, status);
    setOpen(null);
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
      setItems(beforeB);
      setService(beforeS);
      void load();
      void loadService();
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
  }, [load, loadService, toast]);

  const actions: GameActions = useMemo(() => ({
    open: (g) => setOpen(g),
    setStatus: (g, s) => void change(g, s),
    toggle: () => {},
  }), [change]);

  return (
    <div className="ps-collection">
      <div className="ps-pagehead">
        <h1 className="ps-h1">Бэклог</h1>
        {items && items.length > 0 && <p className="ps-statline ps-num"><b>{formatNumber(total)}</b> в списке</p>}
      </div>
      {(items || counts) && (
        <BacklogFilters filters={filters} counts={counts} genreCounts={genreCounts} hltbCounts={hltbCounts} onChange={setFilters} onReset={() => setFilters(resetBacklogFilters(filters))} />
      )}
      <HltbRunner onFinished={() => void load()} />
      {service && service.length > 0 && (
        <nav className="ps-bl-jump" aria-label="Блоки страницы" data-testid="bl-jump">
          <div className="ps-seg">
            <button type="button" onClick={() => jumpTo('h-bl-main')}>Бэклог <b className="num">{formatNumber(total)}</b></button>
            <button type="button" onClick={() => jumpTo('h-bl-service')}>Сервис <b className="num">{formatNumber(serviceTotal)}</b></button>
          </div>
        </nav>
      )}
      {items && (
        <h2 className="ps-h2 ps-h2--icon ps-bl-h" id="h-bl-main" tabIndex={-1} data-testid="bl-main-head">
          <StatusGlyph status="backlog" size={16} />Бэклог <small className="num ps-bl-service__n" data-testid="bl-main-count">{formatNumber(total)}</small>
        </h2>
      )}
      {error && !items ? (
        <EmptyState icon="circle-alert" role="alert" title="Что-то пошло не так" text="Не удалось загрузить бэклог. Попробуй обновить страницу.">
          <button type="button" className="ps-btn ps-btn--primary" onClick={() => void load()}>Обновить</button>
        </EmptyState>
      ) : !items ? (
        <ul className="ps-grid" data-density="comfort" aria-hidden="true" aria-busy="true">
          {Array.from({ length: 12 }, (_, i) => (
            <li key={i}><div className="ps-card ps-card--sk"><div className="ps-skeleton ps-sk-cover" /><div className="ps-skeleton ps-sk-line" /></div></li>
          ))}
        </ul>
      ) : items.length === 0 && hasBacklogFilters(filters) ? (
        <EmptyState icon="search" title="Ничего не найдено" text="В бэклоге нет игр под выбранные фильтры.">
          <button type="button" className="ps-btn ps-btn--primary" onClick={() => setFilters(resetBacklogFilters(filters))}>Сбросить фильтры</button>
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState icon={<StatusGlyph status="backlog" size={40} />} title="Бэклог пуст" text="Поставь играм статус «Бэклог» в коллекции">
          <Link href="/" className="ps-btn ps-btn--primary">К коллекции</Link>
        </EmptyState>
      ) : (
        <div className="ps-bl-list" aria-busy={loading || undefined} data-loading={loading || undefined}>
        <GameGrid density="comfort" label="Игры в бэклоге">
          {items.map((g) => (
            <GameGridItem key={g.id}>
              <GameCard game={g} actions={actions} selectMode={false} selected={false}>
                <p className="ps-bl-dur num" data-testid="bl-duration" data-source={g.duration?.source ?? undefined}>
                  <Icon name="clock" size={12} />
                  <span aria-label={g.duration?.hours != null ? `Длительность ${durationText(g.duration)}` : 'Длительность неизвестна'}>{durationText(g.duration)}</span>
                  {sourceLabel(g.duration?.source ?? null) && <span className="ps-bl-src" data-source={g.duration?.source ?? undefined}>{sourceLabel(g.duration?.source ?? null)}</span>}
                  {isNotOnHltb(g.duration) && <span className="ps-bl-src" data-hltb="not_found" data-testid="bl-no-hltb">нет на HLTB</span>}
                </p>
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
        </div>
      )}
      {items && items.length > 0 && items.length < total && (
        <div className="ps-more">
          <button type="button" className="ps-btn" onClick={() => void loadMore()} disabled={more}>
            {more ? 'Загрузка…' : `Показать ещё (${formatNumber(total - items.length)})`}
          </button>
        </div>
      )}
      {service && service.length > 0 && (
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
            </div>
          )}
        </section>
      )}
      <GameDialog
        game={open ? (items?.find((g) => g.id === open.id) ?? service?.find((g) => g.id === open.id) ?? open) : null} startEditing={false} now={now} onClose={() => setOpen(null)}
        onStatus={(g, s) => void change(g, s)} onDate={() => {}}
        onGameChanged={(g) => { setOpen(g); setItems((l) => l?.map((x) => (x.id === g.id ? g : x)) ?? l); setService((l) => l?.map((x) => (x.id === g.id ? g : x)) ?? l); void load(); void loadService(); }}
      />
    </div>
  );
}
