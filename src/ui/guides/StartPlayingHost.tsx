'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { PLAYING_EVENT, type PlayingGame } from './startPlaying';

const MissableGuideSheet = dynamic(() => import('./MissableGuideSheet').then((m) => m.MissableGuideSheet), { ssr: false });

/** Один на приложение: слушает перевод в «Играю» и показывает «Не пропусти», если есть сопоставленный гайд. */
export function StartPlayingHost() {
  const [game, setGame] = useState<PlayingGame | null>(null);
  const close = useCallback(() => setGame(null), []);
  useEffect(() => {
    const on = (e: Event) => setGame((e as CustomEvent<PlayingGame>).detail);
    window.addEventListener(PLAYING_EVENT, on);
    return () => window.removeEventListener(PLAYING_EVENT, on);
  }, []);
  return game ? <MissableGuideSheet key={game.id} game={game} onClose={close} /> : null;
}
