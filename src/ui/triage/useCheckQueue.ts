'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, deleteHintDismissal, errorText, fetchStatusHints, postHintDismissal, putStatus } from '../collection/api';
import { useToast } from '../primitives/Toast';
import { STATUS_META } from '../tokens';
import type { GameStatusValue } from '@/server/collection/types';
import {
  acceptHint, dismissHint, dropHint, hintQuestion, isCurrentStatus, keepHint, replayHint, rollbackHint, undoHint, initHints, type HintState,
} from './hints';

/**
 * Очередь «Проверить» (design-system §13.3-13.4). Сайт только предлагает: статус меняют «Принять» и клавиши 1-6 (PUT status),
 * «Оставить как есть» на сервер не пишет, «Не предлагать» пишет отказ по правилу. Запросы идут цепочкой, отмена не обгоняет действие.
 */
export function useCheckQueue(active: boolean) {
  const toast = useToast();
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

  const undo = useCallback(() => {
    const s = ref.current;
    if (!s) return;
    const r = undoHint(s);
    const a = r.undone;
    if (!a) return;
    commit(r.state);
    const failed = (what: string) => (e: unknown) => {
      update((cur) => replayHint(cur, a));
      toast({ kind: 'error', text: `${what} ${errorText(e)}` });
    };
    if (a.kind === 'accept') send(() => putStatus(a.hint.gameId, a.hint.currentStatus), failed('Не удалось вернуть статус.'));
    else if (a.kind === 'dismiss') send(() => deleteHintDismissal(a.hint.gameId, a.hint.rule), failed('Не удалось вернуть подсказку.'));
    toast({ text: 'Действие отменено' });
  }, [commit, update, send, toast]);

  const accept = useCallback((status: GameStatusValue) => {
    const s = ref.current;
    const head = s?.queue[0];
    if (!s || !head || isCurrentStatus(head, status)) return;
    commit(acceptHint(s, status));
    send(() => putStatus(head.gameId, status), (e) => {
      if (e instanceof ApiError && e.status === 404) {
        update((cur) => dropHint(cur, head.gameId));
        toast({ text: 'Игра не найдена, подсказка убрана' });
        return;
      }
      update((cur) => rollbackHint(cur, head.gameId));
      toast({ kind: 'error', text: `Не удалось сменить статус. ${errorText(e)}` });
    });
    toast({ text: `Статус изменён: ${STATUS_META[status].label}`, action: { label: 'Отменить', run: undo } });
  }, [commit, update, send, toast, undo]);

  const keep = useCallback(() => { update(keepHint); }, [update]);

  function dismiss() {
    const s = ref.current;
    const head = s?.queue[0];
    if (!s || !head) return;
    commit(dismissHint(s));
    send(() => postHintDismissal(head.gameId, head.rule), () => {
      update((cur) => rollbackHint(cur, head.gameId));
      toast({ kind: 'error', text: 'Не удалось сохранить отказ. Повтори', action: { label: 'Повторить', run: dismiss } });
    });
    toast({ text: `Не предлагаем «${hintQuestion(head.rule)}» для «${head.game.title}»`, ttl: 8000, action: { label: 'Отменить', run: undo } });
  }

  return { state, error, load, accept, keep, dismiss, undo };
}

export type CheckQueue = ReturnType<typeof useCheckQueue>;
