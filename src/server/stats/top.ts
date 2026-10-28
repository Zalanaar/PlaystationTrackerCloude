// Топ игр периода (контракт 13.2): по часам и по очкам трофеев. Чистые функции, без БД.
import type { TrophyType } from './trophies';
import type { TrophyCountsByType } from './types';
import { secondsToHours } from './hours';

export const TOP_LIMIT = 10;

/** Очки трофеев (очки уровня PSN, без бонуса за редкость). */
export const TROPHY_POINTS: Record<TrophyType, number> = { bronze: 15, silver: 30, gold: 90, platinum: 300 };

export type HoursRank = { gameId: number; seconds: number; hours: number; estimated: boolean };
export type TrophyRank = { gameId: number; points: number; counts: TrophyCountsByType };
/** Строка группировки: сколько трофеев типа `type` игра получила в периоде. */
export type GameTrophyCount = { gameId: number; type: TrophyType; n: number };

/** lower(title) по кодовым точкам (как в контракте, без локали), затем id. */
const byTitle = (titles: ReadonlyMap<number, string>, a: number, b: number): number => {
  const ta = (titles.get(a) ?? '').toLowerCase();
  const tb = (titles.get(b) ?? '').toLowerCase();
  return ta < tb ? -1 : ta > tb ? 1 : a - b;
};

/**
 * Топ по секундам периода (реальные + оценка, как у `hours`). Игры с 0 секунд не входят.
 * Порядок: секунды по убыванию, lower(title), id.
 */
export function rankByHours(
  seconds: ReadonlyMap<number, number>,
  estimatedSeconds: ReadonlyMap<number, number>,
  titles: ReadonlyMap<number, string>,
  limit = TOP_LIMIT,
): HoursRank[] {
  return [...seconds]
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1] || byTitle(titles, a[0], b[0]))
    .slice(0, limit)
    .map(([gameId, s]) => ({ gameId, seconds: s, hours: secondsToHours(s), estimated: (estimatedSeconds.get(gameId) ?? 0) > 0 }));
}

/** Топ по очкам трофеев периода. Игры без трофеев не входят. Порядок: очки по убыванию, lower(title), id. */
export function rankByTrophies(rows: readonly GameTrophyCount[], titles: ReadonlyMap<number, string>, limit = TOP_LIMIT): TrophyRank[] {
  const by = new Map<number, TrophyCountsByType>();
  for (const r of rows) {
    if (r.n <= 0) continue;
    const c = by.get(r.gameId) ?? { platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 };
    c[r.type] += r.n;
    c.total += r.n;
    by.set(r.gameId, c);
  }
  const points = (c: TrophyCountsByType) => c.platinum * TROPHY_POINTS.platinum + c.gold * TROPHY_POINTS.gold + c.silver * TROPHY_POINTS.silver + c.bronze * TROPHY_POINTS.bronze;
  return [...by]
    .map(([gameId, counts]) => ({ gameId, counts, points: points(counts) }))
    .sort((a, b) => b.points - a.points || byTitle(titles, a.gameId, b.gameId))
    .slice(0, limit);
}
