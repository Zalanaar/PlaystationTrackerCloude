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

/**
 * Элемент-источник, с которого открыли окно игры на другой странице (Статистика, Бэклог, Подскажи, Разбор).
 * Страница пересоздаётся при `back()`, поэтому элемент ищется заново по тегу, подписи и порядковому номеру (R-1).
 */
export type FocusOrigin = { path: string; tag: string; label: string; nth: number };
let focusOrigin: FocusOrigin | null = null;

const labelOf = (el: Element) => (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
const FOCUSABLE = 'a[href],button,[role="button"],[tabindex]:not([tabindex="-1"])';

function captureFocusOrigin(path: string): void {
  focusOrigin = null;
  let el = document.activeElement;
  // фокус внутри поповера (миниатюры жанра): источник = раскрытый триггер поповера
  if (el instanceof HTMLElement && el.closest('[role="dialog"]')) el = document.querySelector<HTMLElement>('[aria-haspopup][aria-expanded="true"]');
  if (!(el instanceof HTMLElement) || el === document.body) return;
  const target = el.matches(FOCUSABLE) ? el : el.closest<HTMLElement>(FOCUSABLE);
  if (!target) return;
  const label = labelOf(target);
  const tag = target.tagName;
  const same = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.tagName === tag && labelOf(x) === label);
  focusOrigin = { path, tag, label, nth: Math.max(0, same.indexOf(target)) };
}

export function peekFocusOrigin(): FocusOrigin | null { return focusOrigin; }
export function clearFocusOrigin(): void { focusOrigin = null; }

/** Найти в текущем документе элемент по сохранённому источнику. */
export function findFocusOrigin(o: FocusOrigin): HTMLElement | null {
  const same = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.tagName === o.tag && labelOf(x) === o.label && x.getClientRects().length > 0);
  return same[Math.min(o.nth, same.length - 1)] ?? null;
}

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
    // игру открыли из приложения (Статистика и др.): возвращаем на исходную страницу, иначе чистим адрес на месте (R-2)
    if (idRef.current !== null && pushedFor === idRef.current) {
      pushedFor = null;
      router.back();
    } else {
      drop();
    }
    toast({ text: GAME_NOT_FOUND_TEXT });
  }, [drop, router, toast]);

  // неверный формат id: диалог не открывается, адрес чистится, тост
  const invalid = parsed.kind === 'invalid';
  const handled = useRef(false);
  useEffect(() => {
    if (!invalid) { handled.current = false; return; }
    if (handled.current) return; // StrictMode повторяет эффект: тост один раз
    handled.current = true;
    notFound();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- только при смене признака
  }, [invalid]);

  return { gameId, tab, open, close, drop, notFound };
}

/**
 * Переход к игре со страницы, отличной от Коллекции (Статистика, Бэклог, Подскажи, Разбор): §8.6,
 * `/?game=<id>[&tab=trophies]` через `router.push`; закрытие окна `back()` возвращает на исходную страницу.
 */
export function useOpenGameFromPage() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback((id: number, tab?: GameLinkTab) => {
    pushedFor = id;
    if (pathname !== '/') captureFocusOrigin(pathname);
    router.push(gameHref('', id, tab), { scroll: false });
  }, [pathname, router]);
}
