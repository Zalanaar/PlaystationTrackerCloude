import { plural } from '../format';
import type { HuntGame, HuntTrophy, HuntsView } from '@/shared/hunts';

export const HUNT_TITLE = 'Охочусь сейчас';

export function hasHunt(d: HuntsView | null | undefined): d is HuntsView {
  return !!d && (!!d.game || d.trophies.length > 0);
}

export function huntKey(t: Pick<HuntTrophy, 'setId' | 'trophyId'>): string {
  return `${t.setId}:${t.trophyId}`;
}

export function gameProgressLine(g: HuntGame): string {
  return `${g.earned} из ${g.defined} · осталось ${g.remaining} ${plural(g.remaining, ['трофей', 'трофея', 'трофеев'])}`;
}

export function trophyName(t: HuntTrophy): string {
  if (t.hidden && !t.name) return 'Скрытый трофей';
  return t.name?.trim() || 'Трофей';
}

export function huntingTrophy(data: HuntsView | null | undefined, setId: number, trophyId: number): boolean {
  return !!data?.trophies.some((x) => x.setId === setId && x.trophyId === trophyId);
}

export function huntingGame(data: HuntsView | null | undefined, gameId: number): boolean {
  return data?.game?.id === gameId;
}
