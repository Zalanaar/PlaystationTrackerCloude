'use client';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { COMPLETED_EVENT, type CompletedGame } from './afterComplete';

const AfterCompleteSheet = dynamic(() => import('./AfterCompleteSheet').then((m) => m.AfterCompleteSheet), { ssr: false });

/** Один на приложение: слушает «Пройдено» и показывает лист (идея 3). */
export function AfterCompleteHost() {
  const [game, setGame] = useState<CompletedGame | null>(null);
  useEffect(() => {
    const on = (e: Event) => setGame((e as CustomEvent<CompletedGame>).detail);
    window.addEventListener(COMPLETED_EVENT, on);
    return () => window.removeEventListener(COMPLETED_EVENT, on);
  }, []);
  return game ? <AfterCompleteSheet key={game.id} game={game} onClose={() => setGame(null)} /> : null;
}
