'use client';

// Пакет 7, п. 2: копия данных для офлайн-просмотра в Cache Storage (кэш «ps-data»). Один слот — активный профиль.
// Пишем только когда страницей управляет service worker (production): без SW экран /offline всё равно не откроется без сети.
import {
  isOfflineSnapshot, OFFLINE_DATA_CACHE, OFFLINE_DATA_KEY, OFFLINE_REFRESH_MS, type OfflineSnapshot,
} from '@/shared/offline-snapshot';

const SNAPSHOT_URL = '/api/offline/snapshot';
let inflight: Promise<void> | null = null;
/** Растёт при каждой очистке: ответ, запрошенный до выхода/смены профиля, не записывается после очистки. */
let generation = 0;

const hasCaches = (): boolean => typeof window !== 'undefined' && 'caches' in window;

export async function readOfflineSnapshot(): Promise<OfflineSnapshot | null> {
  if (!hasCaches()) return null;
  try {
    const cache = await caches.open(OFFLINE_DATA_CACHE);
    const hit = await cache.match(OFFLINE_DATA_KEY);
    if (!hit) return null;
    const data: unknown = await hit.json();
    return isOfflineSnapshot(data) ? data : null;
  } catch {
    return null;
  }
}

export async function saveOfflineSnapshot(s: OfflineSnapshot): Promise<void> {
  if (!hasCaches()) return;
  const cache = await caches.open(OFFLINE_DATA_CACHE);
  await cache.put(OFFLINE_DATA_KEY, new Response(JSON.stringify(s), { headers: { 'Content-Type': 'application/json' } }));
}

/** Выход и смена профиля: копия прежнего профиля не должна остаться на устройстве. */
export async function clearOfflineSnapshot(): Promise<void> {
  generation += 1;
  if (!hasCaches()) return;
  try { await caches.delete(OFFLINE_DATA_CACHE); } catch { /* нет доступа к кэшу: нечего чистить */ }
}

/** Нужно ли обновить копию: нет копии, другой профиль или старше OFFLINE_REFRESH_MS. */
export function needsRefresh(s: OfflineSnapshot | null, profileId: number, nowMs: number): boolean {
  if (!s || s.profileId !== profileId) return true;
  const t = Date.parse(s.generatedAt);
  return !Number.isFinite(t) || nowMs - t >= OFFLINE_REFRESH_MS || t - nowMs > 60_000;
}

const swControlled = (): boolean => {
  try { return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !!navigator.serviceWorker.controller; } catch { return false; }
};

/**
 * Обновить копию активного профиля, если она устарела. Тихо: ошибки сети/БД не показываются (копия остаётся прежней,
 * кроме чужого профиля — та стирается). Ответ другого профиля (смена профиля во время запроса) не сохраняется.
 */
export function refreshOfflineSnapshot(profileId: number, getActive: () => number | null, opts: { force?: boolean } = {}): Promise<void> {
  if (!hasCaches() || !swControlled() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return Promise.resolve();
  if (inflight) return inflight;
  let gen = generation;
  inflight = (async () => {
    const cur = await readOfflineSnapshot();
    if (cur && cur.profileId !== profileId) { await clearOfflineSnapshot(); gen = generation; }
    if (!opts.force && !needsRefresh(cur, profileId, Date.now())) return;
    const res = await fetch(SNAPSHOT_URL, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) { await clearOfflineSnapshot(); return; }
    if (!res.ok) return;
    const body: unknown = await res.json();
    const data = (body as { data?: unknown } | null)?.data;
    if (!isOfflineSnapshot(data) || data.profileId !== profileId || getActive() !== profileId || gen !== generation) return;
    await saveOfflineSnapshot(data);
  })().catch(() => {}).finally(() => { inflight = null; });
  return inflight;
}
