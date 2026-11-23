import { call } from '../data/http';
import type { HuntsView } from '@/shared/hunts';

export const HUNTS_CHANGED = 'ps:hunts';

export function announceHunts(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(HUNTS_CHANGED));
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const fetchHunts = (signal?: AbortSignal) => call<HuntsView>('/api/me/hunts', { signal });

export async function putHuntGame(gameId: number | null): Promise<HuntsView> {
  const r = await call<HuntsView>('/api/me/hunts/game', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ gameId }) });
  announceHunts();
  return r;
}

export async function putHuntTrophy(gameId: number, setId: number, trophyId: number, on: boolean): Promise<HuntsView> {
  const r = await call<HuntsView>('/api/me/hunts/trophy', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ gameId, setId, trophyId, on }) });
  announceHunts();
  return r;
}
