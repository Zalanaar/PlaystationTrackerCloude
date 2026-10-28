'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GameDetailsResponse } from '@/server/collection/types';
import { ApiError, fetchGameDetails } from './api';

export type DetailsState =
  | { kind: 'loading' }
  | { kind: 'error'; notFound: boolean }
  | { kind: 'ok'; data: GameDetailsResponse };

/**
 * Детали игры (12.5). `refreshKey` меняется при смене статуса или даты: данные перечитываются без мигания
 * (старый список остаётся, пока не придёт новый; ошибка тихого обновления игнорируется).
 * Сброс при смене игры делает вызывающий через `key` компонента.
 */
export function useGameDetails(id: number, refreshKey: string): { state: DetailsState; retry: () => void } {
  const [state, setState] = useState<DetailsState>({ kind: 'loading' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    fetchGameDetails(id, ac.signal).then(
      (data) => { if (!ac.signal.aborted) setState({ kind: 'ok', data }); },
      (e: unknown) => {
        if (ac.signal.aborted) return;
        setState((prev) => (prev.kind === 'ok' ? prev : { kind: 'error', notFound: e instanceof ApiError && e.status === 404 }));
      },
    );
    return () => ac.abort();
  }, [id, refreshKey, tick]);

  const retry = useCallback(() => { setState({ kind: 'loading' }); setTick((n) => n + 1); }, []);
  return { state, retry };
}
