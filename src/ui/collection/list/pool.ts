import type { GameItem, StatusCounts } from '@/server/collection/types';
import { plural } from '../../format';
import type { BlockId } from '../blocks';

export const PAGE = 60;
/** Потолок дозагрузки при чипе «Платина»: 8 пакетов по 300; дальше остаётся «Показать ещё». */
export const PLATINUM_MAX_BATCHES = 8;
export const BULK_MAX = 1000; // контракт 9.6: один запрос на всё выделение
export const SERVICE_ROWS = 5;
export const SERVICE_ROWS_STEP = 10;
/** Параллельных PUT /hidden при массовом скрытии */
export const HIDE_PARALLEL = 5;
/** Тост с откатом массовых действий висит дольше обычного */
export const UNDO_TTL_MS = 12_000;
export const gamesWord = (n: number) => plural(n, ['игра', 'игры', 'игр']);

export type DateRestore = { kind: 'completed' | 'dropped'; iso: string };
export type Pool = { items: GameItem[]; counts: StatusCounts; total: number; failed: BlockId[]; /** 14.4: забытых во всей коллекции */ forgotten?: number; /** порядок, с которым загружен пул: группы по годам не должны мигать до перезагрузки */ order: 'asc' | 'desc' };
/** Контекст окна игры, открытого из приложения (флаг «Изменить дату», снимок); сам факт «открыто» живёт в адресе ?game= */
export type OpenCtx = { id: number; edit: boolean; snapshot: GameItem };
export const BLOCK_TITLES: Record<BlockId, string> = { playing: 'Играю', chronicle: 'Хроника', backlog: 'Бэклог', service: 'Игры-сервисы', shelved: 'Отложено', unsorted: 'Не разобрано' };

export function oldDate(g: GameItem): DateRestore | undefined {
  if (g.status === 'completed' && g.completedAt) return { kind: 'completed', iso: g.completedAt };
  if (g.status === 'dropped' && g.droppedAt) return { kind: 'dropped', iso: g.droppedAt };
  return undefined;
}

export function union(lists: GameItem[][]): GameItem[] {
  const seen = new Set<number>();
  const out: GameItem[] = [];
  for (const l of lists) for (const g of l) if (!seen.has(g.id)) { seen.add(g.id); out.push(g); }
  return out;
}

export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}
