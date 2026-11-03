'use client';

import { useCallback, useMemo, useState } from 'react';
import type { CollectionSummaryResponse, GameItem } from '@/server/collection/types';
import type { ViewMode } from '../../tokens';
import { blockGames, visibleBlocks, type BlockId } from '../blocks';
import { defaultExpandedYears, emptyCounts, groupByLastPlayedYear, groupChronicle, gridCols } from '../chronicle';
import { applyPlatinum, hasActiveFilters, isChronicleMode, matchesStatusTab, type Filters } from '../filters';
import { nearItems, nearVisible } from '../nearPlatinum';
import { SERVICE_ROWS, type Pool } from './pool';

type Args = {
  filters: Filters; pool: Pool | null; raw: GameItem[]; summary: CollectionSummaryResponse | null;
  now: number; view: ViewMode; width: number; selectMode: boolean; error: boolean;
};

/**
 * Производные списки коллекции: блоки, хроника по годам, «По последней игре», раскрытие групп, «Игры-сервисы».
 * Чистое вычисление из пула и фильтров плюс локальное состояние раскрытия.
 */
export function useCollectionLists({ filters, pool, raw, summary, now, view, width, selectMode, error }: Args) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  // блок «Игры-сервисы»: раскрыт ли, и сколько строк показано в режиме «Список»
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceRows, setServiceRows] = useState(SERVICE_ROWS);

  const chronicleMode = isChronicleMode(filters);
  const active = hasActiveFilters(filters);
  const counts = pool?.counts ?? emptyCounts();
  // raw = всё загруженное с сервера (для подгрузки и счётчиков «осталось»), all = после чипа «Платина» (фильтр на клиенте, 12.6)
  const all = useMemo(() => applyPlatinum(raw, filters.platinum), [raw, filters.platinum]);
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
  const played = useMemo(() => groupByLastPlayedYear(playedMode ? flat : [], pool?.order ?? 'desc'), [flat, pool?.order, playedMode]);
  const isPlayedOpen = (key: string) => (filters.q.trim() ? true : toggled[`lp-${key}`] ?? true);
  const togglePlayed = (key: string) => setToggled((t) => ({ ...t, [`lp-${key}`]: !isPlayedOpen(key) }));
  /** Раскрыть год хроники (переход по якорю) */
  const expandYear = useCallback((year: number) => setToggled((t) => ({ ...t, [String(year)]: true })), []);
  /** Раскрыть группу «По последней игре» (переход по якорю) */
  const expandPlayed = useCallback((key: string) => setToggled((t) => ({ ...t, [`lp-${key}`]: true })), []);

  const density: 'dense' | 'comfort' = view === 'dense' ? 'dense' : 'comfort';
  const cols = gridCols(width, density);
  const visibleChron = [
    ...chron.years.filter((y) => isOpen(y.year)).flatMap((y) => y.months.flatMap((m) => m.games)),
    ...(isOpen('undated') ? chron.undated : []),
  ];
  // «Игры-сервисы»: вкладка «Сервис» раскрывает блок целиком, иначе один ряд (сетка) или несколько строк (список)
  const serviceAll = byBlock.service ?? [];
  const rawLoaded = (b: BlockId) => blockGames(raw, b, filters.status).length;
  /** С чипом «Платина» счётчики сервера не про выбранную выдачу: показываем число найденных игр */
  const shownCount = (serverCount: number, list: GameItem[]) => (filters.platinum ? list.length : serverCount);
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
  const playing = byBlock.playing ?? [];
  const near = useMemo(() => nearItems(summary?.nearPlatinum), [summary]);
  // «Ближе всего к платине» (п.8.2): только на чистой коллекции; пока сводка грузится, вместо блока скелет
  const nearShown = nearVisible({ count: summary ? near.length : 1, chronicle: chronicleMode, status: filters.status, q: filters.q, platinum: filters.platinum, selectMode, hidden: filters.hidden, platform: filters.platform });
  const years = chron.years.map((y) => y.year);
  const showAnchors = chronicleMode && filters.status === 'all' && (years.length > 0 || (byBlock.backlog?.length ?? 0) > 0 || (byBlock.service?.length ?? 0) > 0 || (byBlock.unsorted?.length ?? 0) > 0);

  return {
    chronicleMode, active, counts, flat, blocks, byBlock, chron, played, playedMode, isOpen, toggle, isPlayedOpen, togglePlayed, expandYear, expandPlayed,
    density, cols, rawLoaded, shownCount, serviceFull, serviceOpen, setServiceOpen, serviceRows, setServiceRows, shownGames, failedBlocks, empty,
    hiddenView, noData, hiddenEmpty, playing, near, nearShown, years, showAnchors,
  };
}
