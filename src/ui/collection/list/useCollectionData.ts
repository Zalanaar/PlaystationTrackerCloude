'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CollectionInitial, CollectionSummaryResponse } from '@/server/collection/types';
import { useToast } from '../../primitives/Toast';
import { useProfile } from '../../profile/ProfileProvider';
import { useSync } from '../../sync/SyncProvider';
import { forgottenCountOf } from '../../triage/forgotten';
import { primeApiCache } from '../../data/http';
import { ApiError, errorText, fetchGames, fetchGamesBatch, fetchSummary } from '../api';
import { blockGames, blockSort, blockStatuses, buildPlan, FULL_LIMIT, visibleBlocks, type BlockId } from '../blocks';
import { blockQuery, filtersToApi, isChronicleMode, type Filters } from '../filters';
import { PAGE, PLATINUM_MAX_BATCHES, union, type Pool } from './pool';
import { chroniclePool, seedFromInitial, type Seed } from './seed';

/**
 * Загрузка данных коллекции: сводка, пул игр (хроника блоками или плоский список), подгрузка, перечитывание после синка.
 * `onFiltersKeyChange` вызывается перед перезагрузкой при смене фильтров (сброс выбора).
 * `initial` (item 4): сводка и пакет блоков из серверного рендера `/`. Подходят к фильтрам: первый рендер (и HTML) сразу с играми,
 * ответы ложатся в кэш GET, первая загрузка после гидрации пропускается.
 */
export function useCollectionData(filters: Filters, filtersKey: string, onFiltersKeyChange: () => void, initial?: CollectionInitial | null) {
  const toast = useToast();
  const sync = useSync();
  const { publish: publishProfile } = useProfile();
  // только первый рендер: новые initial при клиентской навигации не перетирают живое состояние
  const [seed] = useState<Seed | null>(() => {
    const s = seedFromInitial(initial, filters);
    // облегчённые тела (slim) не равны ответам API: в кэш GET не кладём, следующий заход за ними пойдёт в сеть
    if (s && !s.initial.slim) {
      primeApiCache(s.initial.summaryUrl, s.initial.summary);
      primeApiCache(s.initial.batchUrl, s.initial.batch);
    }
    return s;
  });
  const [summary, setSummary] = useState<CollectionSummaryResponse | null>(seed?.summary ?? null);
  const [pool, setPool] = useState<Pool | null>(seed?.pool ?? null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [loading, setLoading] = useState(!seed);
  const skipSummary = useRef(!!seed);
  const skipLoadKey = useRef<string | null>(seed ? filtersKey : null);
  const [error, setError] = useState(false);
  const [more, setMore] = useState(false);

  const poolRef = useRef<Pool | null>(null);
  useEffect(() => { poolRef.current = pool; }, [pool]);
  const reqId = useRef(0);
  const moreAbort = useRef<AbortController | null>(null);
  const filtersRef = useRef(filters);
  useEffect(() => { filtersRef.current = filters; }, [filters]);
  const filtersKeyCb = useRef(onFiltersKeyChange);
  useEffect(() => { filtersKeyCb.current = onFiltersKeyChange; }, [onFiltersKeyChange]);

  const loadSummary = useCallback(async () => {
    try {
      const s = await fetchSummary();
      setSummary(s);
      publishProfile(s.profile ?? null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      setSummaryFailed(true);
      /* сводка необязательна: строка итогов просто не показывается */
    }
  }, [publishProfile]);

  const loadAll = useCallback(async (f: Filters, keep: number) => {
    const id = ++reqId.current;
    moreAbort.current?.abort();
    setLoading(true);
    try {
      let next: Pool;
      if (isChronicleMode(f)) {
        const plan = buildPlan(f.status, f.q, f.platinum, f.platform);
        // все блоки одним запросом (Фаза 48): раньше 6 параллельных /api/games, каждый со своей проверкой сессии
        const rs = await fetchGamesBatch(plan.map((p) => p.query));
        // у упавшего блока остаются ранее загруженные игры его статусов
        const built = chroniclePool(plan, rs, poolRef.current?.items ?? [], f);
        if (!built) {
          const first = rs[0];
          if (first.status === 'rejected' && first.reason instanceof ApiError && first.reason.status === 401) return;
          throw new Error('all blocks failed');
        }
        next = built;
      } else {
        const r = await fetchGames(filtersToApi(f, { limit: Math.max(PAGE, keep), offset: 0 }));
        next = { items: r.items, counts: r.counts, total: r.total, failed: [], forgotten: forgottenCountOf(r.forgottenCount), order: f.order ?? 'desc' };
      }
      // чип «Платина» фильтрует на клиенте (12.6): дозагружаем выдачу пакетами, чтобы чип, карточки и «Показать ещё» были согласованы
      if (f.platinum) {
        const chronTotal = f.status === 'completed' ? next.counts.completed : f.status === 'dropped' ? next.counts.dropped : next.counts.completed + next.counts.dropped;
        for (let i = 0; i < PLATINUM_MAX_BATCHES; i++) {
          if (id !== reqId.current) return;
          let q: URLSearchParams;
          if (isChronicleMode(f)) {
            if (!visibleBlocks(f.status).includes('chronicle')) break;
            const have = blockGames(next.items, 'chronicle', f.status).length;
            if (have >= chronTotal) break;
            q = blockQuery(blockStatuses('chronicle', f.status), blockSort('chronicle'), f.q, { limit: FULL_LIMIT, offset: have }, f.platform);
          } else {
            if (next.items.length >= next.total) break;
            q = filtersToApi(f, { limit: FULL_LIMIT, offset: next.items.length });
          }
          let r;
          try { r = await fetchGames(q); } catch { break; }
          if (r.items.length === 0) break;
          next = { ...next, counts: r.counts, total: isChronicleMode(f) ? r.total : next.total, items: union([next.items, r.items]) };
        }
      }
      if (id !== reqId.current) return;
      setPool(next);
      setError(false);
    } catch {
      if (id !== reqId.current) return;
      setError(true);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (skipSummary.current && seed) {
      // сводка уже из HTML: только профиль для шапки
      skipSummary.current = false;
      publishProfile(seed.summary.profile ?? null);
      return;
    }
    const t = setTimeout(() => void loadSummary(), 0);
    return () => clearTimeout(t);
  }, [loadSummary, publishProfile, seed]);

  useEffect(() => {
    if (skipLoadKey.current !== null) {
      const same = skipLoadKey.current === filtersKey;
      skipLoadKey.current = null;
      if (same) return; // пул уже из HTML
    }
    const t = setTimeout(() => {
      filtersKeyCb.current(); // выбор не должен захватывать игры из прошлой выдачи
      void loadAll(filtersRef.current, PAGE);
    }, 0);
    return () => clearTimeout(t);
  }, [filtersKey, loadAll]);

  const refresh = useCallback(() => {
    void loadSummary();
    void loadAll(filtersRef.current, poolRef.current?.items.length ?? 0);
  }, [loadAll, loadSummary]);

  // после завершения синка перечитываем данные
  // undefined, пока статус синка не загружен: первый ответ /api/sync/status — точка отсчёта, а не «синк завершился»
  // (иначе коллекция перечитывалась целиком сразу после загрузки: двойные summary и /api/games)
  const lastSuccess = sync.status ? sync.status.lastSuccessAt : undefined;
  const seenSuccess = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (lastSuccess === undefined) return;
    if (seenSuccess.current === undefined) {
      seenSuccess.current = lastSuccess;
      return;
    }
    if (seenSuccess.current !== lastSuccess) {
      seenSuccess.current = lastSuccess;
      const t = setTimeout(refresh, 0);
      return () => clearTimeout(t);
    }
  }, [lastSuccess, refresh]);

  /** Подгрузка: блок (хроника, целиком показанный блок) или плоский список. */
  async function loadMore(block: BlockId | null) {
    const p = poolRef.current;
    if (!p) return;
    const f = filtersRef.current;
    const id = reqId.current;
    moreAbort.current?.abort();
    const ac = new AbortController();
    moreAbort.current = ac;
    setMore(true);
    try {
      let query: URLSearchParams;
      if (block) {
        const have = blockGames(p.items, block, f.status).length;
        query = blockQuery(blockStatuses(block, f.status), blockSort(block), f.q, { limit: FULL_LIMIT, offset: have }, f.platform);
      } else {
        query = filtersToApi(f, { limit: PAGE, offset: p.items.length });
      }
      const r = await fetchGames(query, ac.signal);
      if (id !== reqId.current || ac.signal.aborted) return;
      setPool((l) => (l ? { ...l, counts: r.counts, total: block === 'chronicle' || !block ? r.total : l.total, items: union([l.items, r.items]) } : l));
    } catch (e) {
      if (id !== reqId.current || ac.signal.aborted) return;
      toast({ kind: 'error', text: `Не удалось загрузить ещё. ${errorText(e)}` });
    } finally {
      if (moreAbort.current === ac) setMore(false);
    }
  }

  return { summary, summaryFailed, pool, setPool, loading, error, more, poolRef, filtersRef, loadAll, loadMore, refresh, seeded: seed !== null };
}
