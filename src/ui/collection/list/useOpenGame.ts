'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameItem } from '@/server/collection/types';
import { useGameLink } from '../useGameLink';
import type { OpenCtx } from './pool';

/**
 * Окно игры: факт «открыто» живёт в адресе ?game= (useGameLink), контекст из приложения (флаг «Изменить дату», снимок) в `open`.
 * Заголовок вкладки и возврат фокуса на h1 после закрытия.
 */
export function useOpenGame(raw: GameItem[]) {
  const [open, setOpen] = useState<OpenCtx | null>(null);
  const [linked, setLinked] = useState<GameItem | null>(null);
  const link = useGameLink();

  const linkIdRef = useRef<number | null>(null);
  const closeLinkRef = useRef<() => void>(() => {});
  useEffect(() => { linkIdRef.current = link.gameId; closeLinkRef.current = link.close; }, [link.gameId, link.close]);

  const linkOpen = link.open;
  const openGameCard = useCallback((g: GameItem) => { setOpen({ id: g.id, edit: false, snapshot: g }); linkOpen(g.id); }, [linkOpen]);
  // окно игры: из загруженного списка, из снимка (открыто из приложения) или из деталей (прямая ссылка), иначе скелет по id
  const openId = link.gameId;
  const ctx = open && open.id === openId ? open : null;
  const openGame = openId !== null ? (raw.find((g) => g.id === openId) ?? ctx?.snapshot ?? (linked?.id === openId ? linked : null)) : null;
  const openTitle = openGame?.title ?? null;
  useEffect(() => {
    if (!openTitle) return;
    const prev = document.title;
    document.title = `${openTitle} · PS Tracker`;
    return () => { document.title = prev; };
  }, [openTitle]);
  // после закрытия окна фокус на h1, если вернуть его некуда (прямая ссылка)
  const wasOpen = useRef(false);
  useEffect(() => {
    if (openId !== null) { wasOpen.current = true; return; }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const t = setTimeout(() => {
      const a = document.activeElement;
      if (!a || a === document.body) document.getElementById('coll-title')?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [openId]);

  return { open, setOpen, link, setLinked, linkIdRef, closeLinkRef, openId, ctx, openGame, openGameCard };
}
