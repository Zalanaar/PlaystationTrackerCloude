'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameItem } from '@/server/collection/types';
import { isSlimGame } from '../slim';
import { useGameLink } from '../useGameLink';
import type { OpenCtx } from './pool';

/**
 * Окно игры: факт «открыто» живёт в адресе ?game= (useGameLink), контекст из приложения (флаг «Изменить дату», снимок) в `open`.
 * Заголовок вкладки и возврат фокуса на h1 после закрытия.
 */
export function useOpenGame(raw: GameItem[], seed: GameItem | null = null) {
  const [open, setOpen] = useState<OpenCtx | null>(null);
  // P1-2: игра прямой ссылки из серверного рендера — шапка окна (баннер, плитки) без ожидания деталей
  const [linked, setLinked] = useState<GameItem | null>(seed);
  const link = useGameLink();

  const linkIdRef = useRef<number | null>(null);
  const closeLinkRef = useRef<() => void>(() => {});
  useEffect(() => { linkIdRef.current = link.gameId; closeLinkRef.current = link.close; }, [link.gameId, link.close]);

  const linkOpen = link.open;
  const openGameCard = useCallback((g: GameItem) => { setOpen({ id: g.id, edit: false, snapshot: g }); linkOpen(g.id); }, [linkOpen]);
  // окно игры: из загруженного списка, из снимка (открыто из приложения) или из деталей (прямая ссылка), иначе скелет по id
  const openId = link.gameId;
  const ctx = open && open.id === openId ? open : null;
  const fromList = openId !== null ? raw.find((g) => g.id === openId) : undefined;
  const fromLink = openId !== null && linked?.id === openId ? linked : null;
  // облегчённая карточка из HTML без баннера: полная игра прямой ссылки лучше (её заменят детали или правка в списке)
  const openGame = openId !== null ? ((fromList && !(fromLink && isSlimGame(fromList)) ? fromList : null) ?? ctx?.snapshot ?? fromLink) : null;
  const openTitle = openGame?.title ?? null;
  useEffect(() => {
    if (!openTitle) return;
    const prev = document.title;
    const want = `${openTitle} · PS Tracker`;
    const apply = () => { if (document.title !== want) document.title = want; };
    apply();
    // Next стримит metadata (<title> из layout) и может вставить его уже после этого эффекта (медленная сеть/CPU, прямая ссылка
    // /?game=): тогда заголовок окна затирался на «PS Tracker». Пока окно открыто, возвращаем свой заголовок.
    const mo = new MutationObserver(apply);
    mo.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => { mo.disconnect(); document.title = prev; };
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
