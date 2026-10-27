// Трофеи за период по earned_at (контракт 1.5, 10.1). Чистые функции.
import { mskDate } from './period';
import type { TrophyCountsByType } from './types';

export type TrophyType = 'platinum' | 'gold' | 'silver' | 'bronze';
export type EarnedTrophy = { type: TrophyType; earnedAt: Date | null };

export const emptyTrophyCounts = (): TrophyCountsByType => ({ platinum: 0, gold: 0, silver: 0, bronze: 0, total: 0 });

function add(c: TrophyCountsByType, t: TrophyType) {
  c[t] += 1;
  c.total += 1;
}

/**
 * Счётчики за [fromUtc, toUtc) и помесячная линия года `year` (по МСК).
 * Трофеи без earnedAt игнорируются.
 */
export function aggregateTrophies(
  list: readonly EarnedTrophy[],
  fromUtc: Date,
  toUtc: Date,
  year: number,
): { counts: TrophyCountsByType; byMonth: (TrophyCountsByType & { month: number })[] } {
  const counts = emptyTrophyCounts();
  const byMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, ...emptyTrophyCounts() }));
  for (const t of list) {
    if (!t.earnedAt) continue;
    const ms = t.earnedAt.getTime();
    if (ms >= fromUtc.getTime() && ms < toUtc.getTime()) add(counts, t.type);
    const d = mskDate(t.earnedAt);
    if (d.year === year) add(byMonth[d.month - 1], t.type);
  }
  return { counts, byMonth };
}
