// Клиент API «Подскажи» (контракт docs/api-contract.md §18). Только типы из server.
import type { RecommendResponse } from '@/server/recommend/types';
import { call } from '../collection/api';
import type { TimeValue } from './model';

export type { RecommendItem, RecommendResponse } from '@/server/recommend/types';

/** Скрытая «на сейчас» игра (контракт §18.9, GET /api/recommend/dislikes). */
export type DislikeItem = {
  game: { id: number; name: string; imageUrl: string | null; bannerUrl: string | null; genres: string[] };
  hiddenAt: string;
  expiresAt: string;
};
export type DislikesResponse = { items: DislikeItem[]; ttlDays: number };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const fetchRecommend = (time: TimeValue, signal?: AbortSignal) =>
  call<RecommendResponse>(time === 'any' ? '/api/recommend' : `/api/recommend?time=${time}`, { signal });
export const postDislike = (gameId: number) =>
  call<{ gameId: number }>('/api/recommend/dislike', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ gameId }) });
export const deleteDislike = (gameId: number) => call<{ gameId: number }>(`/api/recommend/dislike/${gameId}`, { method: 'DELETE' });
export const fetchDislikes = () => call<DislikesResponse>('/api/recommend/dislikes');
