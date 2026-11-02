'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { GameItem } from '@/server/collection/types';
import { registerCacheReset } from '../profiles/scope';
import { fetchGames } from './api';
import { suggestManual } from './manualApi';
import { suggestCacheClear, suggestCacheGet, suggestCacheSet } from './suggestCache';
import {
  LIST_DEBOUNCE_MS, SUGGEST_DEBOUNCE_MS, SUGGEST_MIN, cacheKey, classifySuggestError, createGuard, guardedState, matchesQuery, storeStateFor, suggestQuery,
  type StoreState,
} from './suggest';

/** Блокировки каталога живут, пока открыта вкладка: подсказки и Enter-поиск не бьют в лимит до resetAt (43.1.3). */
export const catalogGuard = createGuard();
registerCacheReset(() => { catalogGuard.reset(); suggestCacheClear(); });

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb); };
};
export const useOnline = (): boolean => useSyncExternalStore(subscribeOnline, () => navigator.onLine !== false, () => true);

/**
 * Подсказки магазина PS: от 3 символов, debounce 350 мс, устаревший запрос отменяется (AbortController), результат устаревшего игнорируется.
 * Повтор того же запроса отдаётся из кэша без запроса. Состояние считается при рендере из ввода, кэша, блокировок и последнего ответа.
 */
export function useStoreSuggest(rawQuery: string, enabled: boolean, max: number): { state: StoreState; retry: () => void } {
  const q = suggestQuery(rawQuery);
  const key = cacheKey(q);
  const online = useOnline();
  const [res, setRes] = useState<{ key: string; state: StoreState } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [, force] = useState(0);

  const short = q.length < SUGGEST_MIN;
  const cached = suggestCacheGet(key);
  const guard = guardedState(catalogGuard.status());
  const needsFetch = enabled && !short && cached === null && guard === null && online;

  // поле очищено или набрано заново: следующий ввод получает свежие флаги (TTL и сброс при правках не покрывают правки на другом устройстве)
  useEffect(() => { if (enabled && q.length === 0) suggestCacheClear(); }, [enabled, q]);

  useEffect(() => {
    if (!needsFetch) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await suggestManual(q, ctl.signal);
        if (ctl.signal.aborted) return;
        suggestCacheSet(key, r.candidates);
        setRes({ key, state: storeStateFor(q.length, r.candidates, max) });
      } catch (e) {
        if (ctl.signal.aborted) return;
        const f = classifySuggestError(e, typeof navigator === 'undefined' || navigator.onLine !== false);
        if (f.kind === 'limited') catalogGuard.limit(f.resetAt);
        else if (f.kind === 'quota') catalogGuard.quota(f.resetAt);
        else if (f.kind === 'hidden') catalogGuard.unavailable();
        if (f.kind === 'error' || f.kind === 'offline') setRes({ key, state: { kind: f.kind } });
        else force((n) => n + 1);
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => { clearTimeout(t); ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- max влияет только на отображение, запрос зависит от ключа
  }, [needsFetch, key, nonce]);

  const retry = useCallback(() => { setRes(null); setNonce((n) => n + 1); }, []);

  let state: StoreState;
  if (!enabled) state = { kind: 'idle' };
  else if (short) state = storeStateFor(q.length, null, max);
  else if (cached !== null) state = storeStateFor(q.length, cached, max);
  else if (guard) state = guard;
  else if (!online) state = { kind: 'offline' };
  else if (res && res.key === key) state = res.state;
  else state = { kind: 'loading' };
  return { state, retry };
}

/** Игры библиотеки в Бэклоге по подстроке (GET /api/games?status=backlog&q=): блок «Из списка». От 1 символа, debounce 150 мс. */
export function useLocalGames(rawQuery: string, enabled: boolean, limit = 8): { items: GameItem[]; settled: boolean } {
  const q = suggestQuery(rawQuery);
  const [res, setRes] = useState<{ q: string; items: GameItem[] } | null>(null);
  const on = enabled && q.length > 0;
  useEffect(() => {
    if (!on) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetchGames(new URLSearchParams({ status: 'backlog', q, sort: 'title', limit: String(limit), offset: '0' }), ctl.signal);
        if (!ctl.signal.aborted) setRes({ q, items: r.items });
      } catch {
        if (!ctl.signal.aborted) setRes({ q, items: [] });
      }
    }, LIST_DEBOUNCE_MS);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [on, q, limit]);
  if (!on) return { items: [], settled: true };
  // пока идёт debounce, прежние строки остаются, но только подходящие под новый ввод
  return res && res.q === q ? { items: res.items, settled: true } : { items: (res?.items ?? []).filter((g) => matchesQuery(g.title, q)), settled: false };
}
