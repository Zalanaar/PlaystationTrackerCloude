'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, deleteHintDismissal, errorText, fetchStatusHints, postHintDismissal, putStatus } from '../collection/api';
import { useToast, useToastDismiss } from '../primitives/Toast';
import { STATUS_META } from '../tokens';
import type { GameStatusValue } from '@/server/collection/types';
import {
  acceptHint, dismissHint, dropHint, hintQuestion, isCurrentStatus, keepHint, lastAction, replayHint, rollbackHint, settleConflict, undoAcceptBody, undoHintById, initHints,
  type HintAction, type HintItem, type HintState,
} from './hints';

/**
 * Очередь «Проверить» (design-system §13.3-13.4). Сайт только предлагает: статус меняют «Принять» и клавиши 1-6 (PUT status),
 * «Оставить как есть» на сервер не пишет, «Не предлагать» пишет отказ по правилу. Запросы идут цепочкой, отмена не обгоняет действие.
 */
export function useCheckQueue(active: boolean) {
  const toast = useToast();
  const dismissToast = useToastDismiss();
  const [state, setState] = useState<HintState | null>(null);
  const [error, setError] = useState(false);
  const ref = useRef<HintState | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const reqId = useRef(0);

  const commit = useCallback((next: HintState | null) => { ref.current = next; setState(next); }, []);
  const update = useCallback((f: (s: HintState) => HintState) => { if (ref.current) commit(f(ref.current)); }, [commit]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setError(false);
    try {
      const r = await fetchStatusHints();
      if (id !== reqId.current) return;
      commit(initHints(r.items));
    } catch (e) {
      if (id !== reqId.current) return;
      if (e instanceof ApiError && e.status === 401) return;
      setError(true);
    }
  }, [commit]);

  // вход в режим и смена режима перезапускают очередь с начала
  useEffect(() => {
    const t = setTimeout(() => {
      if (active) { commit(null); void load(); } else { reqId.current++; commit(null); setError(false); }
    }, 0);
    return () => clearTimeout(t);
  }, [active, load, commit]);

  const send = useCallback((job: () => Promise<unknown>, onFail: (e: unknown) => void) => {
    const run = async () => { try { await job(); } catch (e) { onFail(e); } };
    chain.current = chain.current.then(run, run);
  }, []);

  // единственный видимый тост действия: id действия и id тоста
  const live = useRef<{ actionId: number; toastId: number } | null>(null);
  const showFor = useCallback((actionId: number, t: Parameters<typeof toast>[0]) => {
    if (live.current) dismissToast(live.current.toastId);
    live.current = { actionId, toastId: toast(t) };
  }, [toast, dismissToast]);
  const closeFor = useCallback((actionId: number) => {
    if (live.current?.actionId === actionId) { dismissToast(live.current.toastId); live.current = null; }
  }, [dismissToast]);

  const conflict = useCallback((hint: HintItem, actionId: number) => {
    update((cur) => settleConflict(cur, hint, actionId));
    if (live.current) { dismissToast(live.current.toastId); live.current = null; }
    toast({ kind: 'warning', text: 'Статус уже изменён в другом месте. Подсказка могла устареть.', ttl: 8000, action: { label: 'Обновить подсказку', run: () => { void load(); } } });
  }, [update, toast, dismissToast, load]);

  /** Откат конкретного действия (кнопка «Отменить» в тосте или Z). Нет действия в истории = тост устарел, ничего не делаем. */
  const undoAction = useCallback((actionId: number) => {
    const s = ref.current;
    if (!s) return;
    const r = undoHintById(s, actionId);
    const a = r.undone;
    if (!a) return;
    commit(r.state);
    closeFor(actionId);
    const failed = (what: string) => (e: unknown) => {
      if (a.kind === 'accept' && e instanceof ApiError && e.status === 409) { conflict(a.hint, a.id); return; }
      update((cur) => replayHint(cur, a));
      toast({ kind: 'error', text: `${what} ${errorText(e)}` });
    };
    if (a.kind === 'accept') {
      const body = undoAcceptBody(a);
      send(() => putStatus(a.hint.gameId, body.status, { expectedStatus: body.expectedStatus, restore: body.restore }), failed('Не удалось вернуть статус.'));
    } else if (a.kind === 'dismiss') send(() => deleteHintDismissal(a.hint.gameId, a.hint.rule), failed('Не удалось вернуть подсказку.'));
    live.current = null;
    toast({ text: 'Действие отменено' });
  }, [commit, update, send, toast, closeFor, conflict]);

  const undo = useCallback(() => {
    const s = ref.current;
    const last = s && [...s.history].reverse().find((x) => x.kind !== 'conflict');
    if (last) undoAction(last.id);
  }, [undoAction]);

  const accept = useCallback((status: GameStatusValue) => {
    const s = ref.current;
    const head = s?.queue[0];
    if (!s || !head || isCurrentStatus(head, status)) return;
    const next = acceptHint(s, status); // снимок прошлой строки снимается здесь, до PUT
    const action = lastAction(next) as HintAction;
    commit(next);
    send(() => putStatus(head.gameId, status, { expectedStatus: head.currentStatus }), (e) => {
      if (e instanceof ApiError && e.status === 409) { conflict(head, action.id); return; }
      if (e instanceof ApiError && e.status === 404) {
        update((cur) => dropHint(cur, head.gameId));
        toast({ text: 'Игра не найдена, подсказка убрана' });
        return;
      }
      update((cur) => rollbackHint(cur, head.gameId));
      toast({ kind: 'error', text: `Не удалось сменить статус. ${errorText(e)}` });
    });
    showFor(action.id, { text: `Статус изменён: ${STATUS_META[status].label}`, action: { label: 'Отменить', run: () => undoAction(action.id) } });
  }, [commit, update, send, toast, undoAction, showFor, conflict]);

  const keep = useCallback(() => { update(keepHint); }, [update]);

  function dismiss() {
    const s = ref.current;
    const head = s?.queue[0];
    if (!s || !head) return;
    const next = dismissHint(s);
    const action = lastAction(next) as HintAction;
    commit(next);
    send(() => postHintDismissal(head.gameId, head.rule), () => {
      update((cur) => rollbackHint(cur, head.gameId));
      toast({ kind: 'error', text: 'Не удалось сохранить отказ. Повтори', action: { label: 'Повторить', run: dismiss } });
    });
    showFor(action.id, { text: `Не предлагаем «${hintQuestion(head.rule)}» для «${head.game.title}»`, ttl: 8000, action: { label: 'Отменить', run: () => undoAction(action.id) } });
  }

  return { state, error, load, accept, keep, dismiss, undo };
}

export type CheckQueue = ReturnType<typeof useCheckQueue>;
