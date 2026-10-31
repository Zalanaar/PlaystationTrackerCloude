// Вход оценки часов до первого снимка (контракт 1.6): первый снимок игры + даты запусков. Только выборка.
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { snapshotGameVisible } from '@/server/collection/visibility';
import { getDuplicateMap } from './duplicates';
import { applyExclusions, getMonthExclusions, type MonthExclusions } from './exclusions';
import type { EstimateInput } from './hours';

const { games, playtimeSnapshots: ps } = schema;

/**
 * Конец оценки L0 = last_played_at ПЕРВОГО снимка игры (games.last_played_at синк перезаписывает текущим,
 * см. 1.6, Фаза 8.1). Исключённые месяцы (15.1) передаются в `exclusions` (getMonthExclusions). Fallback на games.last_played_at, только если в снимке NULL. Скрытые игры (9.10) исключены.
 */
export async function getEstimateInputs(db: AnyDb, userId: UserId, exclusions?: MonthExclusions): Promise<EstimateInput[]> {
  const [rows, ex, dup] = await Promise.all([rowsQuery(db, userId), exclusions ? Promise.resolve(exclusions) : getMonthExclusions(db, userId), getDuplicateMap(db, userId)]);
  return applyExclusions(
    rows.map((r) => ({
      // 25.3: оценка дубля относится к главной (часы версий суммируются)
      gameId: dup.get(r.gameId) ?? r.gameId,
      firstSnapshotDate: r.date,
      firstSeconds: r.seconds,
      firstPlayedAt: r.firstPlayedAt,
      lastPlayedAt: r.snapLastPlayedAt ?? r.gameLastPlayedAt,
    })),
    ex,
  );
}

function rowsQuery(db: AnyDb, userId: UserId) {
  return db
    .selectDistinctOn([ps.gameId], {
      gameId: ps.gameId,
      date: ps.snapshotDate,
      seconds: ps.playDurationSeconds,
      snapLastPlayedAt: ps.lastPlayedAt,
      firstPlayedAt: games.firstPlayedAt,
      gameLastPlayedAt: games.lastPlayedAt,
    })
    .from(ps)
    .innerJoin(games, eq(games.id, ps.gameId))
    .where(and(eq(ps.userId, userId), eq(games.userId, userId), snapshotGameVisible(games.id, userId)))
    .orderBy(ps.gameId, asc(ps.snapshotDate));
}
