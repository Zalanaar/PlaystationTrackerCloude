// Клиент API роадмапа (контракт docs/api-contract.md §17). Только типы из server.
import type { PlannedGameDto, RoadmapResponse, SettingsView } from '@/server/roadmap/types';
import { ApiError, call } from '../collection/api';
import { mutationErrorText, type CatalogCandidateView, type PlannedBody } from './model';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const fetchRoadmap = (signal?: AbortSignal) => call<RoadmapResponse>('/api/roadmap', { signal });
export const putSettings = (year: number, hoursPerWeek: number) =>
  call<{ settings: SettingsView }>('/api/roadmap/settings', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ year, hoursPerWeek }) });
export const fetchPlanned = (signal?: AbortSignal) => call<{ planned: PlannedGameDto[] }>('/api/roadmap/planned?status=planned', { signal });
export const postPlanned = (body: PlannedBody) =>
  call<{ planned: PlannedGameDto }>('/api/roadmap/planned', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
export const patchPlanned = (id: number, body: Partial<Omit<PlannedBody, 'externalSource' | 'externalId'>>) =>
  call<{ planned: PlannedGameDto }>(`/api/roadmap/planned/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(body) });
export const deletePlanned = (id: number) => call<{ deleted: boolean; id: number }>(`/api/roadmap/planned/${id}`, { method: 'DELETE' });
export const putOrder = (gameIds: number[]) =>
  call<{ order: number[] }>('/api/roadmap/order', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ gameIds }) });
/** onlyPlayStation: фильтр на сервере (параметр playstation=1, контракт 17.9). */
export const searchCatalog = (q: string, onlyPlayStation: boolean, signal?: AbortSignal) =>
  call<{ candidates: CatalogCandidateView[] }>(`/api/roadmap/catalog/search?q=${encodeURIComponent(q)}${onlyPlayStation ? '&playstation=1' : ''}`, { signal });

export { ApiError };

/** Понятный текст ошибки мутации. */
export function mutationError(e: unknown): string {
  return e instanceof ApiError ? mutationErrorText(e.status, e.code, e.reason) : 'Нет связи с сервером.';
}
