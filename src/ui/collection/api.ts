// Клиент API коллекции (контракт docs/api-contract.md §9). Только типы из server, без кода БД.
import type { StatsResponse } from '@/server/stats/types';
import type { WrappedResponse } from '@/server/wrapped/types';
import type {
  BulkStatusResponse, CollectionSummaryResponse, GameItem, GameMutationResponse, GamesListResponse, GameStatusValue,
} from '@/server/collection/types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 503 || e.code === 'db_unavailable') return 'База данных недоступна.';
    if (e.status === 404) return 'Игра не найдена. Обнови страницу.';
    if (e.code === 'status_conflict') return 'Дату можно менять только у пройденной или брошенной игры.';
    if (e.status === 400) return 'Сервер отклонил запрос.';
    if (e.status === 401) return 'Сессия истекла. Войди заново.';
  }
  return 'Нет связи с сервером.';
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init });
  } catch {
    throw new ApiError(0, 'network', 'network');
  }
  const json = await res.json().catch(() => null);
  if (res.status === 401 && typeof window !== 'undefined') {
    // полная перезагрузка: сброс клиентского состояния на странице входа
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }
  if (!res.ok || !json?.ok) throw new ApiError(res.status, json?.error?.code ?? 'unknown', json?.error?.message ?? 'error');
  return json.data as T;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const fetchSummary = () => call<CollectionSummaryResponse>('/api/collection/summary');
export const fetchGames = (query: URLSearchParams, signal?: AbortSignal) =>
  call<GamesListResponse>(`/api/games?${query.toString()}`, { signal });

export const fetchStats = (query: URLSearchParams, signal?: AbortSignal) =>
  call<StatsResponse>(`/api/stats?${query.toString()}`, { signal });

export const fetchWrapped = (year: number | null, signal?: AbortSignal) =>
  call<WrappedResponse>(year === null ? '/api/wrapped' : `/api/wrapped?year=${year}`, { signal });

export const putStatus = (id: number, status: GameStatusValue | null) =>
  call<GameMutationResponse>(`/api/games/${id}/status`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ status }) });

export const patchStatusDate = (id: number, kind: 'completed' | 'dropped', iso: string) =>
  call<GameMutationResponse>(`/api/games/${id}/status-date`, {
    method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(kind === 'completed' ? { completedAt: iso } : { droppedAt: iso }),
  });

export const postBulk = (ids: number[], status: GameStatusValue | null) =>
  call<BulkStatusResponse>('/api/games/status-bulk', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ids, status }) });

export type { GameItem };
