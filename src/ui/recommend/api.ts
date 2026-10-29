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

// ---- Фаза 13b, режим «Новое от ИИ» (контракт §19) ----
import type { DiscoverItem, DiscoverResponse } from '@/server/recommend/discover';
import type { ExternalDislikeItem } from '@/server/recommend/discover-dislikes';

export type { DiscoverItem, DiscoverMeta, DiscoverResponse } from '@/server/recommend/discover';
export type { ExternalDislikeItem } from '@/server/recommend/discover-dislikes';
export type ExternalDislikesResponse = { items: ExternalDislikeItem[]; ttlDays: number };

/** Клиентский таймаут долгого подбора (§19.6, спека 15.7). */
export const DISCOVER_TIMEOUT_MS = 65_000;

export const fetchDiscover = (refresh: boolean, signal?: AbortSignal) =>
  call<DiscoverResponse>(refresh ? '/api/recommend/discover?refresh=1' : '/api/recommend/discover', { signal });
export const postDiscoverDislike = (it: Pick<DiscoverItem, 'externalId' | 'title' | 'coverUrl'>) =>
  call<{ externalId: string }>('/api/recommend/discover/dislike', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ externalSource: 'rawg', externalId: it.externalId, title: it.title, coverUrl: it.coverUrl }),
  });
export const deleteDiscoverDislike = (externalId: string) =>
  call<{ externalId: string }>(`/api/recommend/discover/dislike/${encodeURIComponent(externalId)}`, { method: 'DELETE' });
export const fetchDiscoverDislikes = () => call<ExternalDislikesResponse>('/api/recommend/discover/dislikes');
