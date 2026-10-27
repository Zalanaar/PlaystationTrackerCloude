// План загрузки блоков Коллекции (design-system §4.3): какие блоки видны при выбранной вкладке статуса и какими запросами они грузятся.
import type { GameItem, GameSort, StatusFilterValue } from '@/server/collection/types';
import { byLastPlayed } from './chronicle';
import { blockQuery, type StatusTab } from './filters';

export type BlockId = 'playing' | 'chronicle' | 'backlog' | 'shelved' | 'unsorted';

export const BLOCK_STATUSES: Record<BlockId, readonly StatusFilterValue[]> = {
  playing: ['playing'], chronicle: ['completed', 'dropped'], backlog: ['backlog'], shelved: ['shelved'], unsorted: ['none'],
};
const ORDER: readonly BlockId[] = ['playing', 'chronicle', 'backlog', 'shelved', 'unsorted'];

export const PREVIEW_LIMIT = 12;
export const FULL_LIMIT = 300;
export const PLAYING_LIMIT = 20;

/** Блоки, видимые при вкладке статуса: все при «Все», иначе только содержащий этот статус. */
export function visibleBlocks(tab: StatusTab): BlockId[] {
  if (tab === 'all') return [...ORDER];
  return ORDER.filter((b) => (BLOCK_STATUSES[b] as readonly string[]).includes(tab));
}

/** Блок показан целиком (вкладка выбрана явно), а не превью одним рядом. */
export function isFull(block: BlockId, tab: StatusTab): boolean {
  return tab !== 'all' || block === 'chronicle' || block === 'shelved';
}

export function blockStatuses(block: BlockId, tab: StatusTab): StatusFilterValue[] {
  return tab === 'all' ? [...BLOCK_STATUSES[block]] : [tab as StatusFilterValue];
}

export function blockSort(block: BlockId): GameSort {
  return block === 'chronicle' ? 'completed_at' : 'last_played';
}

export type PlanItem = { block: BlockId; query: URLSearchParams };

/** Запросы для режима хроники. */
export function buildPlan(tab: StatusTab, q: string): PlanItem[] {
  return visibleBlocks(tab).map((block) => {
    const limit = block === 'playing' && tab === 'all' ? PLAYING_LIMIT : isFull(block, tab) ? FULL_LIMIT : PREVIEW_LIMIT;
    return { block, query: blockQuery(blockStatuses(block, tab), blockSort(block), q, { limit, offset: 0 }) };
  });
}

export function inBlock(g: Pick<GameItem, 'status'>, block: BlockId, tab: StatusTab): boolean {
  const key = g.status ?? 'none';
  return (blockStatuses(block, tab) as string[]).includes(key);
}

/** Игры блока из общего пула: хроника в порядке групп, остальные по последнему запуску. */
export function blockGames(pool: readonly GameItem[], block: BlockId, tab: StatusTab): GameItem[] {
  const list = pool.filter((g) => inBlock(g, block, tab));
  return block === 'chronicle' ? list : list.sort(byLastPlayed);
}
