// Клиент API «не куплено» (docs/api-contract.md, Фаза 43). Только типы из server.
import type { GameRef, ManualGame, ManualMatch, SearchResponse } from './manual';
import { call } from './api';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const fetchManual = (signal?: AbortSignal) => call<{ items: ManualGame[] }>('/api/manual-games', { signal });

export const searchManual = (q: string, signal?: AbortSignal) =>
  call<SearchResponse>(`/api/manual-games/search?q=${encodeURIComponent(q)}`, { signal });

export type ManualAddBody = { externalSource: 'rawg'; externalId: string; title: string; coverUrl: string | null; releaseDate: string | null; confirmDuplicate?: boolean };
export const addManual = (body: ManualAddBody) =>
  call<{ item: ManualGame; created: boolean }>('/api/manual-games', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });

/** «Купил»: снять пометку. */
export const markPurchased = (id: number) => call<{ item: ManualGame }>(`/api/manual-games/${id}/purchased`, { method: 'POST', headers: JSON_HEADERS, body: '{}' });
/** «Отменить»: вернуть пометку. */
export const unmarkPurchased = (id: number) => call<{ item: ManualGame }>(`/api/manual-games/${id}/purchased`, { method: 'DELETE' });
export const removeManual = (id: number) => call<{ id: number; removed: boolean }>(`/api/manual-games/${id}`, { method: 'DELETE' });

export const fetchMatches = (signal?: AbortSignal) => call<{ matches: ManualMatch[] }>('/api/manual-games/matches', { signal });
export const answerMatch = (id: number, answer: 'yes' | 'no') =>
  call<{ id: number; answer: 'yes' | 'no'; linked: GameRef | null }>(`/api/manual-games/${id}/match`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ answer }) });
