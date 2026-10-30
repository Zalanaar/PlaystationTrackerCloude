'use client';

import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { GameItem, GameStatusValue } from '@/server/collection/types';
import { formatNumber } from '../../format';
import { useToast } from '../../primitives/Toast';
import { STATUS_META } from '../../tokens';
import { errorText, patchStatusDate, postBulk, putHidden, putStatus } from '../api';
import { applyStatusLocally, adjustCounts, removeFromCounts } from '../filters';
import { mapLimit } from '../limit';
import { gamesWord, HIDE_PARALLEL, oldDate, UNDO_TTL_MS, type DateRestore, type OpenCtx, type Pool } from './pool';

type Args = {
  poolRef: MutableRefObject<Pool | null>;
  setPool: Dispatch<SetStateAction<Pool | null>>;
  setOpen: Dispatch<SetStateAction<OpenCtx | null>>;
  refresh: () => void;
  selected: Set<number>;
  setSelected: Dispatch<SetStateAction<Set<number>>>;
  setSelectMode: (v: boolean) => void;
  linkIdRef: MutableRefObject<number | null>;
  closeLinkRef: MutableRefObject<() => void>;
};

/** Смена статуса, даты, скрытие игр (одиночные и массовые) с оптимистичным обновлением пула и откатом через тост. */
export function useGameMutations({ poolRef, setPool, setOpen, refresh, selected, setSelected, setSelectMode, linkIdRef, closeLinkRef }: Args) {
  const toast = useToast();
  const undoRef = useRef<((g: GameItem, s: GameStatusValue | null, silent?: boolean, restore?: DateRestore) => Promise<void>) | null>(null);
  const hideRef = useRef<((g: GameItem, hidden: boolean, silent?: boolean) => Promise<void>) | null>(null);
  const bulkHideRef = useRef<((ids: number[], hidden: boolean, silent?: boolean) => Promise<void>) | null>(null);

  const replaceGames = useCallback((games: GameItem[]) => {
    const by = new Map(games.map((g) => [g.id, g]));
    setPool((l) => (l ? { ...l, items: l.items.map((g) => by.get(g.id) ?? g) } : l));
    setOpen((o) => (o && by.get(o.id) ? { ...o, snapshot: by.get(o.id) as GameItem } : o));
  }, [setOpen, setPool]);

  const shiftCounts = useCallback((from: GameStatusValue | null, to: GameStatusValue | null) => {
    setPool((l) => (l ? { ...l, counts: adjustCounts(l.counts, from, to) } : l));
  }, [setPool]);

  const current = useCallback((g: GameItem): GameItem => {
    return poolRef.current?.items.find((x) => x.id === g.id) ?? g;
  }, [poolRef]);

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
      const r = await postBulk(ids, status);
      const changed = r.changed;
      replaceGames(r.games);
      toast({ text: `Статус «${STATUS_META[status ?? 'none'].label}»: изменено игр ${changed} из ${ids.length}` });
      setSelected(new Set());
      setSelectMode(false);
      refresh();
    } catch (e) {
      replaceGames(prevs);
      for (const g of prevs) shiftCounts(status, g.status);
      toast({ kind: 'error', text: `Массовая смена не выполнена, ничего не изменено. ${errorText(e)}` });
    }
  }, [poolRef, refresh, replaceGames, selected, setSelectMode, setSelected, shiftCounts, toast]);

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
    if (linkIdRef.current !== null && set.has(linkIdRef.current)) closeLinkRef.current();
  }, [closeLinkRef, linkIdRef, setOpen, setPool, setSelected]);

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
  }, [current, dropFromPool, poolRef, refresh, toast]);

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
  }, [dropFromPool, refresh, setSelectMode, setSelected, toast]);

  useEffect(() => { bulkHideRef.current = bulkHidden; }, [bulkHidden]);

  return { replaceGames, setStatus, setDate, bulk, setHidden, bulkHidden };
}
