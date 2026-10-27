'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameItem, GameStatusValue } from '@/server/collection/types';
import { EmptyState } from '../EmptyState';
import { formatNumber } from '../format';
import { StatusGlyph } from '../icons';
import { useNow } from '../primitives/hooks';
import { useToast } from '../primitives/Toast';
import { STATUS_META } from '../tokens';
import { ApiError, errorText, fetchGames, putStatus } from './api';
import { GameCard, type GameActions } from './GameCard';
import { GameDialog } from './GameDialog';
import { GameGrid, GameGridItem } from './GameGrid';

const LIMIT = 300;

/** Страница «Бэклог»: игры со статусом backlog, быстрые действия «Начать играть» и «Убрать из бэклога». */
export function BacklogView() {
  const toast = useToast();
  const now = useNow();
  const [items, setItems] = useState<GameItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<GameItem | null>(null);
  const [more, setMore] = useState(false);
  const itemsRef = useRef<GameItem[] | null>(null);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const load = useCallback(async () => {
    setError(false);
    try {
      const r = await fetchGames(new URLSearchParams({ status: 'backlog', sort: 'last_played', limit: String(LIMIT), offset: '0' }));
      setItems(r.items);
      setTotal(r.total);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      setError(true);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function loadMore() {
    const have = itemsRef.current ?? [];
    setMore(true);
    try {
      const r = await fetchGames(new URLSearchParams({ status: 'backlog', sort: 'last_played', limit: String(LIMIT), offset: String(have.length) }));
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
      ) : items.length === 0 ? (
        <EmptyState icon={<StatusGlyph status="backlog" size={40} />} title="Бэклог пуст" text="Поставь играм статус «Бэклог» в коллекции">
          <Link href="/" className="ps-btn ps-btn--primary">К коллекции</Link>
        </EmptyState>
      ) : (
        <GameGrid density="comfort" label="Игры в бэклоге">
          {items.map((g) => (
            <GameGridItem key={g.id}>
              <GameCard game={g} actions={actions} selectMode={false} selected={false}>
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
      />
    </div>
  );
}
