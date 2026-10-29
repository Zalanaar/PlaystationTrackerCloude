// Клиент API «Подскажи» (контракт docs/api-contract.md §18). Только типы из server.
import type { DislikesResponse, RecommendResponse } from '@/server/recommend/types';
import { call } from '../collection/api';
import type { TimeValue } from './model';

export type { DislikeItem, DislikesResponse, RecommendItem, RecommendResponse } from '@/server/recommend/types';


const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const fetchRecommend = (time: TimeValue, signal?: AbortSignal) =>
  call<RecommendResponse>(time === 'any' ? '/api/recommend' : `/api/recommend?time=${time}`, { signal });
export const postDislike = (gameId: number) =>
  call<{ gameId: number }>('/api/recommend/dislike', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ gameId }) });
export const deleteDislike = (gameId: number) => call<{ gameId: number }>(`/api/recommend/dislike/${gameId}`, { method: 'DELETE' });
export const fetchDislikes = () => call<DislikesResponse>('/api/recommend/dislikes');
