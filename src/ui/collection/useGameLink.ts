'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useToast } from '../primitives/Toast';
import { closedHref, gameHref, GAME_NOT_FOUND_TEXT, parseGameParam, parseGameTab, type GameLinkTab } from './gameLink';

/**
 * Запись истории, созданная самим приложением (клик по карточке, ссылка из Плана): закрытие окна делает `back()`.
 * Модульная переменная живёт, пока не перезагружена страница; прямая ссылка (Telegram) её не имеет, там закрытие делает `replace`.
 */
let pushedFor: number | null = null;

/** Ссылки из других страниц (Plan) помечают, что запись истории создана приложением. */
export function markGamePushed(id: number): void {
  pushedFor = id;
}

/**
 * Окно игры как состояние адреса `/?game=<id>` (§8.6). Открытие через `router.push` (системное «назад» закрывает окно),
 * закрытие `back()` или `replace` для прямой ссылки. Неверный формат id: параметр убирается, тост.
 */
export function useGameLink() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const parsed = useMemo(() => parseGameParam(params.get('game')), [params]);
  const tab: GameLinkTab = parseGameTab(params);
  const gameId = parsed.kind === 'ok' ? parsed.id : null;
  const paramsRef = useRef(params);
  useEffect(() => { paramsRef.current = params; }, [params]);
  const idRef = useRef(gameId);
  useEffect(() => { idRef.current = gameId; }, [gameId]);

  const open = useCallback((id: number) => {
    pushedFor = id;
    router.push(gameHref(paramsRef.current.toString(), id), { scroll: false });
  }, [router]);

  /** Убрать `game` из адреса без записи в историю (не найдена игра, неверный id). */
  const drop = useCallback(() => {
    pushedFor = null;
    router.replace(closedHref(pathname, paramsRef.current.toString()), { scroll: false });
  }, [pathname, router]);

  const close = useCallback(() => {
    if (idRef.current !== null && pushedFor === idRef.current) {
      pushedFor = null;
      router.back();
    } else {
      drop();
    }
  }, [drop, router]);

  const notFound = useCallback(() => {
    drop();
    toast({ text: GAME_NOT_FOUND_TEXT });
  }, [drop, toast]);

  // неверный формат id: диалог не открывается, адрес чистится, тост
  const invalid = parsed.kind === 'invalid';
  useEffect(() => {
    if (invalid) notFound();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- только при смене признака
  }, [invalid]);

  return { gameId, tab, open, close, drop, notFound };
}
