import type { GameItem } from '@/server/collection/types';

type PoolLike = { items: GameItem[]; total: number } | null;

/**
 * Число на чипе «Платина» (Фаза 48, п. 15). Без поиска это `summary.totals.platinumEarned` (вся коллекция).
 * С поиском сводка не фильтруется, поэтому при загруженной целиком выборке считаем по ней: пустой поиск даёт 0, а не общий итог.
 * Пока выборка неполная (подгрузка) или задан статус, оставляем итог сводки.
 */
export function platinumChipCount(summaryTotal: number | null, f: { q: string; status: string }, pool: PoolLike): number | null {
  if (!f.q.trim() || !pool) return summaryTotal;
  if (pool.total === 0) return 0;
  if (f.status !== 'all' || pool.items.length < pool.total) return summaryTotal;
  return pool.items.filter((g) => g.trophies?.platinumEarned === true).length;
}
