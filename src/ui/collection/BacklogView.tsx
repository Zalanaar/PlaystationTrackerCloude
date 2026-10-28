'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DurationCounts, GameItem, GenreCounts, GameStatusValue } from '@/server/collection/types';
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
  BACKLOG_PAGE, backlogToApi, backlogToUrl, durationText, hasBacklogFilters, parseBacklogFilters, resetBacklogFilters, sourceLabel,
  type BacklogFilters as Filters,
} from './backlog';
import { GameCard, type GameActions } from './GameCard';
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
  const [loading, setLoading] = useState(true);
  const reqRef = useRef(0);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<GameItem | null>(null);
  const [more, setMore] = useState(false);
  const itemsRef = useRef<GameItem[] | null>(null);
  useEffect(() => { itemsRef.current = items; }, [items]);

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
    // игра пропадает из списка сразу; при ошибке возвращается на место
    const before = itemsRef.current ?? [];
    const leaves = status !== 'backlog';
    if (leaves) {
      setItems(before.filter((g) => g.id !== game.id));
      setTotal((n) => Math.max(0, n - 1));
      setOpen(null);
    }
    try {
      await putStatus(game.id, status);
      if (leaves) void load();
      toast({
        text: `Статус изменён: ${STATUS_META[status ?? 'none'].label}`,
        action: { label: 'Отменить', run: () => void restore(game) },
      });
    } catch (e) {
      if (leaves) {
        setItems(before);
        setTotal((n) => n + 1);
      }
      toast({ kind: 'error', text: `Не удалось сменить статус. ${errorText(e)}` });
    }
    async function restore(g: GameItem) {
      try {
        await putStatus(g.id, 'backlog');
        void load();
        toast({ text: 'Статус возвращён' });
      } catch (e) {
        toast({ kind: 'error', text: `Не удалось вернуть статус. ${errorText(e)}` });
      }
    }
  }, [load, toast]);

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
        <BacklogFilters filters={filters} counts={counts} genreCounts={genreCounts} onChange={setFilters} onReset={() => setFilters(resetBacklogFilters(filters))} />
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
                </p>
                <div className="ps-quick">
                  <button type="button" className="ps-btn ps-btn--primary ps-btn--sm" onClick={() => void change(g, 'playing')}>
                    <StatusGlyph status="playing" size={14} />Начать играть
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
      <GameDialog
        game={open ? (items?.find((g) => g.id === open.id) ?? open) : null} startEditing={false} now={now} onClose={() => setOpen(null)}
        onStatus={(g, s) => void change(g, s)} onDate={() => {}}
        onGameChanged={(g) => { setOpen(g); setItems((l) => l?.map((x) => (x.id === g.id ? g : x)) ?? l); void load(); }}
      />
    </div>
  );
}
