// Общий HTTP-слой клиента (Фаза 47): конверт `{ ok, data | error }`, 401 -> /login, короткий кэш GET с дедупликацией.
// Только типы и fetch: без кода БД. Модули API экранов (collection, roadmap, inbox, ...) строятся поверх `call`/`cachedGet`.
import { registerCacheReset } from '../profiles/scope';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public reason?: string, public details?: unknown) {
    super(message);
  }
}

export async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method === 'GET') return request<T>(url, init);
  // любая запись может поменять данные кэшированных GET: сбрасываем до и после (GET, начатые до записи, в кэш не лягут)
  invalidateApiCache();
  try {
    return await request<T>(url, init);
  } finally {
    invalidateApiCache();
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
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
  if (!res.ok || !json?.ok) throw new ApiError(res.status, json?.error?.code ?? 'unknown', json?.error?.message ?? 'error', json?.error?.details?.reason, json?.error?.details);
  return json.data as T;
}

/**
 * Сколько живёт ответ GET в памяти вкладки. Возврат на экран (коллекция -> Бэклог -> коллекция) в этом окне не перечитывает
 * те же эндпоинты. Свежесть держат сбросы: любая запись через `call`, смена профиля PSN, завершение синка (SyncProvider).
 */
export const GET_CACHE_TTL_MS = 30_000;

type Entry = { at: number; data: unknown };
const done = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
let generation = 0;

/** Сбросить кэш GET (запись, синк, смена профиля, тесты). Запросы в полёте после сброса в кэш не попадут. */
export function invalidateApiCache(): void {
  generation++;
  done.clear();
  inflight.clear();
}

registerCacheReset(invalidateApiCache);

/**
 * Положить в кэш GET ответ, который сервер уже отдал в HTML (первый экран `/`, item 4): тот же URL не запрашивается повторно.
 * Свежий ответ в кэше не перетирается.
 */
export function primeApiCache(url: string, data: unknown): void {
  if (typeof window === 'undefined') return;
  const hit = done.get(url);
  if (hit && Date.now() - hit.at < GET_CACHE_TTL_MS) return;
  done.set(url, { at: Date.now(), data });
}

/**
 * GET с кэшем: свежий ответ из памяти; одинаковые параллельные запросы без `signal` делят один fetch.
 * Запрос с `signal` идёт своим fetch (отмена одного потребителя не рвёт ответ другим), но результат кладёт в кэш.
 * Только для чтений без побочных эффектов и без опроса (опрос должен видеть свежие данные).
 */
export function cachedGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  if (typeof window === 'undefined') return request<T>(url, { cache: 'no-cache', signal });
  const hit = done.get(url);
  if (hit && Date.now() - hit.at < GET_CACHE_TTL_MS) return Promise.resolve(hit.data as T);
  if (!signal) {
    const p = inflight.get(url);
    if (p) return p as Promise<T>;
  }
  const gen = generation;
  // no-cache (не no-store): браузер шлёт If-None-Match, тяжёлые эндпоинты с ETag отвечают 304 без тела
  const p = request<T>(url, { cache: 'no-cache', ...(signal ? { signal } : {}) }).then((data) => {
    if (gen === generation) done.set(url, { at: Date.now(), data });
    return data;
  });
  if (!signal) {
    inflight.set(url, p);
    const drop = () => { if (inflight.get(url) === p) inflight.delete(url); };
    p.then(drop, drop);
  }
  return p;
}
