// Клиент API коллекции (контракт docs/api-contract.md §9). Только типы из server, без кода БД.
import { HltbCallError, type HltbRunBody, type HltbRunResponse } from './hltbRun';
import type { ActivityResponse } from '@/server/stats/activity';
import type { StatsResponse } from '@/server/stats/types';
import type { WrappedResponse } from '@/server/wrapped/types';
import type {
  BulkStatusResponse, CollectionSummaryResponse, GameDetailsResponse, GameItem, GameMutationResponse, GamesBatchResponse, GamesListResponse, GameStatusValue,
  StatusBackupsResponse, StatusResetAllResponse, StatusRestoreResponse,
} from '@/server/collection/types';

import { ApiError, cachedGet, call } from '../data/http';
import { gamesBatchUrl } from './batchUrl';

// call/ApiError живут в общем слое ../data/http; реэкспорт для модулей API экранов
export { ApiError, call, invalidateApiCache } from '../data/http';

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

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const fetchSummary = () => cachedGet<CollectionSummaryResponse>('/api/collection/summary');
export const fetchGames = (query: URLSearchParams, signal?: AbortSignal) =>
  cachedGet<GamesListResponse>(`/api/games?${query.toString()}`, signal);

// URL пакета в чистом модуле: его считает и серверная страница `/` (item 4), а этот модуль тянет клиентский кэш
export { gamesBatchUrl };

/**
 * Несколько выборок 9.2 одним запросом (блоки хроники, Фаза 48). Результат как у Promise.allSettled по каждой выборке:
 * упавший блок = rejected с ApiError 503, сбой всего запроса (сеть, 401, 503) = все rejected с этой ошибкой.
 */
export async function fetchGamesBatch(queries: readonly URLSearchParams[]): Promise<PromiseSettledResult<GamesListResponse>[]> {
  let r: GamesBatchResponse;
  try {
    r = await cachedGet<GamesBatchResponse>(gamesBatchUrl(queries));
    if (!Array.isArray(r?.results) || r.results.length !== queries.length) throw new ApiError(502, 'bad_response', 'bad batch response');
  } catch (e) {
    return queries.map(() => ({ status: 'rejected' as const, reason: e }));
  }
  return settleBatch(r);
}

/** Ответ пакета → как Promise.allSettled по выборкам (общий путь для сети и данных из HTML, item 4). */
export function settleBatch(r: GamesBatchResponse): PromiseSettledResult<GamesListResponse>[] {
  return r.results.map((x) => (x.ok
    ? { status: 'fulfilled' as const, value: x.data }
    : { status: 'rejected' as const, reason: new ApiError(503, x.code, 'block failed') }));
}

/** Детали игры и список трофеев для окна (12.5). 404 = игра не найдена. */
export const fetchGameDetails = (id: number, signal?: AbortSignal) => call<GameDetailsResponse>(`/api/games/${id}`, { signal });

export const fetchStats = (query: URLSearchParams, signal?: AbortSignal) =>
  cachedGet<StatsResponse>(`/api/stats?${query.toString()}`, signal);

/** Стрик и карта активности года (14.3). Грузится лениво, отдельно от /api/stats. */
export const fetchActivity = (year: number, signal?: AbortSignal) =>
  cachedGet<ActivityResponse>(`/api/stats/activity?year=${year}`, signal);

export const fetchWrapped = (year: number | 'all' | null, signal?: AbortSignal) =>
  cachedGet<WrappedResponse>(year === null ? '/api/wrapped' : `/api/wrapped?year=${year}`, signal);

/** PUT status. `expectedStatus` (ключ есть, даже null) = оптимистичная проверка, 409 `status_conflict`; `restore` = откат строки статуса (контракт 28.9). */
export const putStatus = (
  id: number, status: GameStatusValue | null,
  opts?: { expectedStatus?: GameStatusValue | null; restore?: { status: GameStatusValue; statusChangedAt: string; completedAt: string | null; droppedAt: string | null } },
) =>
  call<GameMutationResponse>(`/api/games/${id}/status`, {
    method: 'PUT', headers: JSON_HEADERS,
    body: JSON.stringify({ status, ...(opts?.expectedStatus !== undefined ? { expectedStatus: opts.expectedStatus } : {}), ...(opts?.restore ? { restore: opts.restore } : {}) }),
  });

export const patchStatusDate = (id: number, kind: 'completed' | 'dropped', iso: string) =>
  call<GameMutationResponse>(`/api/games/${id}/status-date`, {
    method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(kind === 'completed' ? { completedAt: iso } : { droppedAt: iso }),
  });

export const postBulk = (ids: number[], status: GameStatusValue | null) =>
  call<BulkStatusResponse>('/api/games/status-bulk', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ids, status }) });

/** Ручная длительность (16.5): hours 0,1..1000 или null (сброс к HLTB). */
export const patchDuration = (id: number, hours: number | null) =>
  call<GameMutationResponse>(`/api/games/${id}/duration`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ hours }) });

/** Ответ PUT /api/games/{id}/month-exclusions (контракт 15.1). */
export type MonthExclusionResponse = {
  gameId: number; month: string; excluded: boolean; excludedMonths: string[]; redistributed: boolean; estimateDropped: boolean;
};

/** «Убрать из этого месяца» / «Вернуть в месяц». 409 `month_exclusion_conflict`: нельзя убрать последний месяц оценки. */
export const putMonthExclusion = (id: number, month: string, excluded: boolean) =>
  call<MonthExclusionResponse>(`/api/games/${id}/month-exclusions`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ month, excluded }) });

/** «Это не дубль» (Фаза 23): версия перестаёт склеиваться с главной. Ответ: обновлённая игра. */
export const postNotDuplicate = (id: number) =>
  call<GameMutationResponse>(`/api/games/${id}/not-duplicate`, { method: 'POST', headers: JSON_HEADERS, body: '{}' });

/** Мягкое удаление из коллекции и возврат (9.7). */
export const putHidden = (id: number, hidden: boolean) =>
  call<GameMutationResponse>(`/api/games/${id}/hidden`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ hidden }) });

/** Сброс статусов всей коллекции (9.8). Слово подтверждения в UI русское, на сервер всегда уходит RESET. */
export const postResetAll = () =>
  call<StatusResetAllResponse>('/api/games/status-reset-all', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ confirm: 'RESET' }) });

/** Откат из копии статусов (9.9). */
export const postRestore = (backupId: number) =>
  call<StatusRestoreResponse>('/api/games/status-restore', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ backupId }) });

/** Последняя копия статусов `reset_all` (9.9a). */
export const fetchStatusBackups = (signal?: AbortSignal) => cachedGet<StatusBackupsResponse>('/api/games/status-backups', signal);

export type { GameItem };

/**
 * Один вызов массовой подгрузки HLTB (16.7). Ошибки отдаются как HltbCallError (код HTTP, код и причина).
 * Отмена через signal даёт AbortError (не сбой).
 */
export async function fetchHltbRun(body: HltbRunBody, signal?: AbortSignal): Promise<HltbRunResponse> {
  try {
    return await call<HltbRunResponse>('/api/hltb/run', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal?.aborted) throw new DOMException('Запрос отменён', 'AbortError');
    if (e instanceof ApiError) throw new HltbCallError(e.status, e.code, e.reason);
    throw e;
  }
}

// ---------- Подсказки смены статуса (контракт 28). Сайт только предлагает; статус меняет putStatus. ----------
export const fetchStatusHints = () => call<import('../triage/hints').HintsResponse>('/api/status-hints');

/** Число подсказок для чипа/сегмента. Без редиректа на вход и без исключений: сбой = null (чип просто не показывается). */
export async function fetchStatusHintCount(): Promise<number | null> {
  try {
    const res = await fetch('/api/status-hints/count', { cache: 'no-store' });
    const json = await res.json().catch(() => null);
    const n = json?.ok ? json.data?.count : null;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

export const postHintDismissal = (gameId: number, rule: string) =>
  call<{ gameId: number; rule: string }>('/api/status-hints/dismissals', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ gameId, rule }) });
export const deleteHintDismissal = (gameId: number, rule: string) =>
  call<{ gameId: number; rule: string }>(`/api/status-hints/dismissals/${gameId}/${rule}`, { method: 'DELETE' });
