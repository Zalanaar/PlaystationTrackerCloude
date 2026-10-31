// Годы с данными для переключателя периода (10.1). Общий для /api/stats и «за всё время» (26.1).
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { gameVisible, snapshotGameVisible, trophySetCounted } from '@/server/collection/visibility';
import { estimateYears, type EstimateInput } from './hours';

const { gameStatus, playtimeSnapshots: ps, trophies } = schema;
const TZ = 'Europe/Moscow';

export async function getStatsYears(db: AnyDb, userId: UserId, currentYear: number, estimates: readonly EstimateInput[] = []): Promise<number[]> {
  const yearOf = (col: unknown) => sql<number | null>`extract(year from (${col} at time zone ${TZ}))::int`;
  const [snap, tr, comp, drop] = await Promise.all([
    db.selectDistinct({ y: sql<number>`extract(year from ${ps.snapshotDate})::int` }).from(ps).where(and(eq(ps.userId, userId), snapshotGameVisible(ps.gameId, userId))),
    db.selectDistinct({ y: yearOf(trophies.earnedAt) }).from(trophies).where(and(eq(trophies.userId, userId), isNotNull(trophies.earnedAt), trophySetCounted(trophies.trophySetId, userId))),
    db.selectDistinct({ y: yearOf(gameStatus.completedAt) }).from(gameStatus).where(and(eq(gameStatus.userId, userId), isNotNull(gameStatus.completedAt), gameVisible(gameStatus.gameId, userId))),
    db.selectDistinct({ y: yearOf(gameStatus.droppedAt) }).from(gameStatus).where(and(eq(gameStatus.userId, userId), isNotNull(gameStatus.droppedAt), gameVisible(gameStatus.gameId, userId))),
  ]);
  const set = new Set<number>([currentYear]);
  for (const r of [...snap, ...tr, ...comp, ...drop]) if (r.y !== null) set.add(r.y);
  for (const y of estimateYears(estimates)) set.add(y);
  return [...set].sort((a, b) => b - a);
}
