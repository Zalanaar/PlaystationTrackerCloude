// Клиент API «Подскажи» (контракт docs/api-contract.md §18). Только типы из server.
import type { DislikesResponse, RecommendResponse } from '@/server/recommend/types';
import type { DiscoverItem, DiscoverResponse } from '@/server/recommend/discover';
import { call } from '../collection/api';
import type { OwnedMark, RecentCollection } from '@/server/owned/marks';
import type { GamesListResponse } from '@/server/collection/types';
import type { LibraryGame, PutBody } from './owned-model';
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

// «Уже есть» (контракт «Фаза 40»)
export type { OwnedMark, RecentCollection } from '@/server/owned/marks';

export const putOwnedMark = (body: PutBody) =>
  call<{ mark: OwnedMark }>('/api/owned-marks', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) });
export const deleteOwnedMark = (externalId: string) =>
  call<{ externalId: string; removed: boolean }>(`/api/owned-marks/${encodeURIComponent(externalId)}`, { method: 'DELETE' });
export const fetchOwnedMarks = (signal?: AbortSignal) => call<{ marks: OwnedMark[] }>('/api/owned-marks', { signal });
export const fetchRecentCollections = (limit = 5, signal?: AbortSignal) =>
  call<{ collections: RecentCollection[] }>(`/api/owned-marks/recent-collections?limit=${limit}`, { signal });

const LIBRARY_PAGE = 300;
/** Библиотека для выбора сборника: видимые главные игры (без скрытых и дублей), страницами по 300. */
export async function fetchLibrary(signal?: AbortSignal): Promise<LibraryGame[]> {
  const out: LibraryGame[] = [];
  for (let offset = 0; offset < 5000; offset += LIBRARY_PAGE) {
    const q = new URLSearchParams({ sort: 'title', order: 'asc', limit: String(LIBRARY_PAGE), offset: String(offset) });
    const r = await call<GamesListResponse>(`/api/games?${q.toString()}`, { signal });
    out.push(...r.items.map((g) => ({ id: g.id, name: g.title, imageUrl: g.coverUrl })));
    if (offset + r.items.length >= r.total || r.items.length === 0) break;
  }
  return out;
}
