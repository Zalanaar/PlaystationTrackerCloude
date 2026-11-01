// Клиент API «Подскажи» (контракт docs/api-contract.md §18). Только типы из server.
import type { DislikesResponse, RecommendResponse } from '@/server/recommend/types';
import type { DiscoverItem, DiscoverResponse } from '@/server/recommend/discover';
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

// «У тебя нет» (контракт «Фаза 30»)
export type { DiscoverItem, DiscoverMeta, DiscoverResponse } from '@/server/recommend/discover';
export const fetchDiscover = (signal?: AbortSignal) => call<DiscoverResponse>('/api/recommend/discover', { signal });
export const postDiscoverDislike = (it: Pick<DiscoverItem, 'externalSource' | 'externalId' | 'title' | 'coverUrl'>) =>
  call<{ externalId: string }>('/api/recommend/discover/dislike', {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ externalSource: it.externalSource, externalId: it.externalId, title: it.title, coverUrl: it.coverUrl }),
  });
export const deleteDiscoverDislike = (externalId: string) =>
  call<{ externalId: string }>(`/api/recommend/discover/dislike/${encodeURIComponent(externalId)}`, { method: 'DELETE' });
