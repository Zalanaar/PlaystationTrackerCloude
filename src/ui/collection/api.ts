// Клиент API коллекции (контракт docs/api-contract.md §9). Только типы из server, без кода БД.
import type { StatsResponse } from '@/server/stats/types';
import type { WrappedResponse } from '@/server/wrapped/types';
import type {
  BulkStatusResponse, CollectionSummaryResponse, GameDetailsResponse, GameItem, GameMutationResponse, GamesListResponse, GameStatusValue,
  StatusResetAllResponse, StatusRestoreResponse,
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

/** Детали игры и список трофеев для окна (12.5). 404 = игра не найдена. */
export const fetchGameDetails = (id: number, signal?: AbortSignal) => call<GameDetailsResponse>(`/api/games/${id}`, { signal });

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

/** Ответ PUT /api/games/{id}/month-exclusions (контракт 15.1). */
export type MonthExclusionResponse = {
  gameId: number; month: string; excluded: boolean; excludedMonths: string[]; redistributed: boolean; estimateDropped: boolean;
};

/** «Убрать из этого месяца» / «Вернуть в месяц». 409 `month_exclusion_conflict`: нельзя убрать последний месяц оценки. */
export const putMonthExclusion = (id: number, month: string, excluded: boolean) =>
  call<MonthExclusionResponse>(`/api/games/${id}/month-exclusions`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ month, excluded }) });

/** Мягкое удаление из коллекции и возврат (9.7). */
export const putHidden = (id: number, hidden: boolean) =>
  call<GameMutationResponse>(`/api/games/${id}/hidden`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ hidden }) });

/** Сброс статусов всей коллекции (9.8). Слово подтверждения в UI русское, на сервер всегда уходит RESET. */
export const postResetAll = () =>
  call<StatusResetAllResponse>('/api/games/status-reset-all', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ confirm: 'RESET' }) });

/** Откат из копии статусов (9.9). */
export const postRestore = (backupId: number) =>
  call<StatusRestoreResponse>('/api/games/status-restore', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ backupId }) });

export type { GameItem };
