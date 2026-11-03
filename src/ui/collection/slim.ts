// Игры из облегчённых данных HTML (item 4, src/server/collection/slim.ts): без длительности, трофеев по типам и баннера (кроме «Играю»).
// Окно игры для таких объектов берёт полный GameItem из GET /api/games/{id}. Любая замена в пуле (смена статуса, перезагрузка) даёт полный объект.
import type { GameItem } from '@/server/collection/types';

const slim = new WeakSet<object>();

export function markSlim(items: Iterable<GameItem>): void {
  for (const g of items) slim.add(g);
}

export function isSlimGame(g: GameItem | null | undefined): boolean {
  return !!g && slim.has(g);
}
