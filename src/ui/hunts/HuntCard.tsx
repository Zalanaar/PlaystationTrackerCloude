'use client';
import { errorText } from '../collection/api';
import { useToast } from '../primitives/Toast';
import { HuntPanel } from './HuntPanel';
import { useTodayBits } from '../collection/TodayBlock';
import { hasHunt } from './model';
import { useHunts } from './useHunts';

/** Карточка «Охочусь сейчас» на главной: прогресс по закреплённой игре и трофеям. */
export function HuntCard() {
  const { data, setGame, setTrophy } = useHunts();
  const toast = useToast();
  const pins = data?.trophies ?? [];
  const hunt = pins.length
    ? `${pins.filter((t) => t.earned).length}/${pins.length}`
    : data?.game
      ? `${data.game.earned}/${data.game.defined}`
      : undefined;
  useTodayBits('hunt', { hunt: hasHunt(data) ? hunt : undefined });
  if (!hasHunt(data)) return null;
  return (
    <HuntPanel
      data={data}
      onUnpinGame={() => { void setGame(null).catch((e) => toast({ kind: 'error', text: errorText(e) })); }}
      onUnpinTrophy={(t) => { void setTrophy(t.gameId, t.setId, t.trophyId, false).catch((e) => toast({ kind: 'error', text: errorText(e) })); }}
    />
  );
}
