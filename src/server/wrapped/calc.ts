// Чистые расчёты слайдов Wrapped (контракт 11.1). Без БД и текущего времени.
import type { GameItem } from '@/server/collection/types';
import type { FinishedEvent } from '@/server/stats/finished';
import { mskDate } from '@/server/stats/period';
import type { WrappedFinishedItem, WrappedPlatinum, WrappedTopGame } from './types';

export const TOP_GAMES = 5;

const byTitle = (a: GameItem, b: GameItem) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()) || a.id - b.id;

/** Топ игр по секундам за год: убывание, ничья по lower(title), id. Игры без карточки пропускаются. */
export function topGamesBySeconds(
  seconds: ReadonlyMap<number, number>,
  gameById: ReadonlyMap<number, GameItem>,
  estimatedSeconds: ReadonlyMap<number, number> = new Map(),
  top = TOP_GAMES,
): WrappedTopGame[] {
  return [...seconds.entries()]
    .filter(([id, s]) => s > 0 && gameById.has(id))
    .map(([id, s]) => ({ s, game: gameById.get(id) as GameItem }))
    .sort((a, b) => b.s - a.s || byTitle(a.game, b.game))
    .slice(0, top)
    .map((x, i) => ({ rank: i + 1, seconds: x.s, hours: Math.round(x.s / 360) / 10, estimated: (estimatedSeconds.get(x.game.id) ?? 0) > 0, game: x.game }));
}

/** Максимум по месяцам (1..12); ничья = более ранний. null, если нет положительных значений. */
export function peakMonth(values: readonly (number | null)[]): { month: number; value: number } | null {
  let best: { month: number; value: number } | null = null;
  values.forEach((v, i) => {
    if (v !== null && v > 0 && (best === null || v > best.value)) best = { month: i + 1, value: v };
  });
  return best;
}

export type FinishedSplit = {
  completed: { count: number; items: WrappedFinishedItem[] };
  dropped: { count: number; items: WrappedFinishedItem[] };
  busiestMonth: { month: number; count: number } | null;
};

export function splitFinished(events: readonly FinishedEvent[], gameById: ReadonlyMap<number, GameItem>): FinishedSplit {
  const rows = events
    .filter((e) => gameById.has(e.gameId))
    .map((e) => ({ e, game: gameById.get(e.gameId) as GameItem }))
    .sort((a, b) => b.e.at.getTime() - a.e.at.getTime() || byTitle(a.game, b.game));
  const pick = (kind: FinishedEvent['kind']) =>
    rows.filter((r) => r.e.kind === kind).map((r) => ({ at: r.e.at.toISOString(), game: r.game }));
  const completed = pick('completed');
  const dropped = pick('dropped');
  const perMonth = new Array<number>(12).fill(0);
  for (const r of rows) perMonth[mskDate(r.e.at).month - 1] += 1;
  const peak = peakMonth(perMonth);
  return {
    completed: { count: completed.length, items: completed },
    dropped: { count: dropped.length, items: dropped },
    busiestMonth: peak ? { month: peak.month, count: peak.value } : null,
  };
}

/** Первая, последняя и самая редкая платина года. */
export function pickPlatinums(list: readonly WrappedPlatinum[]): { first: WrappedPlatinum | null; last: WrappedPlatinum | null; rarest: WrappedPlatinum | null } {
  if (list.length === 0) return { first: null, last: null, rarest: null };
  const sorted = [...list].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  let rarest: WrappedPlatinum | null = null;
  for (const p of sorted) if (p.earnedRate !== null && (rarest === null || p.earnedRate < (rarest.earnedRate as number))) rarest = p;
  return { first: sorted[0], last: sorted[sorted.length - 1], rarest };
}
