// Пройденные/брошенные за период, группировка по месяцам МСК (контракт 10.1). Чистые функции.
import type { GameItem } from '@/server/collection/types';
import { compareTitleId } from '@/server/common/compare';
import { mskDate, ymd } from './period';
import type { FinishedGroup, FinishedItem } from './types';

export type FinishedEvent = { gameId: number; kind: 'completed' | 'dropped'; at: Date };

export function groupFinished(events: readonly FinishedEvent[], gameById: ReadonlyMap<number, GameItem>): FinishedGroup[] {
  const rows = events
    .filter((e) => gameById.has(e.gameId))
    .map((e) => ({ e, game: gameById.get(e.gameId) as GameItem }))
    .sort(
      (a, b) =>
        b.e.at.getTime() - a.e.at.getTime() ||
        compareTitleId(a.game, b.game),
    );
  const groups = new Map<string, FinishedGroup>();
  for (const { e, game } of rows) {
    const d = mskDate(e.at);
    const key = ymd(d.year, d.month, 1).slice(0, 7);
    let g = groups.get(key);
    if (!g) {
      g = { month: key, year: d.year, monthNumber: d.month, items: [] };
      groups.set(key, g);
    }
    const item: FinishedItem = { kind: e.kind, at: e.at.toISOString(), game };
    g.items.push(item);
  }
  return [...groups.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}
