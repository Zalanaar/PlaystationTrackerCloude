'use client';
import { errorText } from '../collection/api';
import { useToast } from '../primitives/Toast';
import { HuntPanel } from './HuntPanel';
import { hasHunt } from './model';
import { useHunts } from './useHunts';

/** Блок «Охочусь сейчас» на вкладке «Трофеи», над «Почти платины». */
export function HuntBlock() {
  const { data, setGame, setTrophy } = useHunts();
  const toast = useToast();
  if (!hasHunt(data)) return null;
  return (
    <HuntPanel
      data={data}
      onUnpinGame={() => { void setGame(null).catch((e) => toast({ kind: 'error', text: errorText(e) })); }}
      onUnpinTrophy={(t) => { void setTrophy(t.gameId, t.setId, t.trophyId, false).catch((e) => toast({ kind: 'error', text: errorText(e) })); }}
    />
  );
}
