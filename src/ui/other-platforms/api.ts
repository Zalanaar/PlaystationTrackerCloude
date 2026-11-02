// Клиент API «Играл на другой платформе» (docs/api-contract.md, Фаза 44). Только типы из server.
import type { CatalogCandidate } from '@/server/catalog/rawg';
import type { OtherPlatformGame } from '@/server/manual/other-platform';
import { call } from '../collection/api';
import type { DuplicateInfo } from '../collection/manual';

export type { OtherPlatformGame };
export type OtherCandidate = CatalogCandidate & { duplicate: 'library' | 'planned' | null; inBacklog: boolean; inList: boolean };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export type OtherAddBody = {
  kind: 'other_platform'; externalSource: 'rawg'; externalId: string; title: string; coverUrl: string | null; releaseDate: string | null;
  platformLabel?: string | null; confirmDuplicate?: boolean;
};

export const fetchOtherPlatforms = (signal?: AbortSignal) =>
  call<{ items: OtherPlatformGame[] }>('/api/manual-games?kind=other_platform', { signal });

export const searchAllPlatforms = (q: string, signal?: AbortSignal) =>
  call<{ candidates: OtherCandidate[]; cached: boolean }>(`/api/manual-games/search?q=${encodeURIComponent(q)}&scope=all`, { signal });

export const addOtherPlatform = (body: OtherAddBody) =>
  call<{ item: OtherPlatformGame; created: boolean }>('/api/manual-games', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });

export const removeOtherPlatform = (id: number) =>
  call<{ id: number; removed: boolean }>(`/api/manual-games/${id}`, { method: 'DELETE' });

/** Тело повторного POST для «Вернуть»: теми же данными, что у удалённой записи. */
export function restoreBody(g: OtherPlatformGame, confirmDuplicate = false): OtherAddBody {
  return {
    kind: 'other_platform', externalSource: 'rawg', externalId: g.externalId, title: g.title, coverUrl: g.coverUrl, releaseDate: g.releaseDate,
    platformLabel: g.platformLabel, ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
  };
}

export type { DuplicateInfo };
