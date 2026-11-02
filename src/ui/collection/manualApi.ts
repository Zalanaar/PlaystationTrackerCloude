// Клиент API «не куплено» (docs/api-contract.md, Фаза 43). Только типы из server.
import type { BatchResult, GameRef, ManualGame, ManualMatch, SearchResponse } from './manual';
import { call } from './api';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const fetchManual = (signal?: AbortSignal) => call<{ items: ManualGame[] }>('/api/manual-games', { signal });

export const searchManual = (q: string, signal?: AbortSignal) =>
  call<SearchResponse>(`/api/manual-games/search?q=${encodeURIComponent(q)}`, { signal });

export type ManualAddBody = { externalSource: 'rawg'; externalId: string; title: string; coverUrl: string | null; releaseDate: string | null; confirmDuplicate?: boolean; notPurchased?: boolean };
export const addManual = (body: ManualAddBody) =>
  call<{ item: ManualGame; created: boolean }>('/api/manual-games', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });

/** Подсказки при вводе (43.1.3): от 3 символов, до 8 кандидатов; отмена через AbortController. */
export const suggestManual = (q: string, signal?: AbortSignal) =>
  call<SearchResponse>(`/api/manual-games/search?q=${encodeURIComponent(q)}&mode=suggest`, { signal });

/** Пакетное добавление, 1..10 игр (43.1.2): результат по каждой игре. */
export const addManualBatch = (items: ManualAddBody[]) =>
  call<{ results: BatchResult[]; created: number }>('/api/manual-games/batch', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ items }) });

/** «Купил»: снять пометку. */
export const markPurchased = (id: number) => call<{ item: ManualGame }>(`/api/manual-games/${id}/purchased`, { method: 'POST', headers: JSON_HEADERS, body: '{}' });
/** «Отменить»: вернуть пометку. */
export const unmarkPurchased = (id: number) => call<{ item: ManualGame }>(`/api/manual-games/${id}/purchased`, { method: 'DELETE' });
export const removeManual = (id: number) => call<{ id: number; removed: boolean }>(`/api/manual-games/${id}`, { method: 'DELETE' });

export const fetchMatches = (signal?: AbortSignal) => call<{ matches: ManualMatch[] }>('/api/manual-games/matches', { signal });
export const answerMatch = (id: number, answer: 'yes' | 'no') =>
  call<{ id: number; answer: 'yes' | 'no'; linked: GameRef | null }>(`/api/manual-games/${id}/match`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ answer }) });
