'use client';
import { useCallback, useEffect, useState } from 'react';
import type { HuntsView } from '@/shared/hunts';
import { fetchHunts, HUNTS_CHANGED, putHuntGame, putHuntTrophy } from './api';

export function useHunts() {
  const [data, setData] = useState<HuntsView | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback((signal?: AbortSignal) => {
    return fetchHunts(signal).then(
      (r) => { if (!signal?.aborted) { setData(r); setFailed(false); } },
      () => { if (!signal?.aborted) setFailed(true); },
    );
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    const on = () => void load();
    window.addEventListener(HUNTS_CHANGED, on);
    return () => { ac.abort(); window.removeEventListener(HUNTS_CHANGED, on); };
  }, [load]);

  const setGame = useCallback(async (gameId: number | null) => {
    const r = await putHuntGame(gameId);
    setData(r);
    setFailed(false);
    return r;
  }, []);

  const setTrophy = useCallback(async (gameId: number, setId: number, trophyId: number, on: boolean) => {
    const r = await putHuntTrophy(gameId, setId, trophyId, on);
    setData(r);
    setFailed(false);
    return r;
  }, []);

  return { data, failed, reload: load, setGame, setTrophy };
}
