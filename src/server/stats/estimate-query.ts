// Вход оценки часов до первого снимка (контракт 1.6): первый снимок игры + даты запусков. Только выборка.
import { asc, eq } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { EstimateInput } from './hours';

const { games, playtimeSnapshots: ps } = schema;

export async function getEstimateInputs(db: AnyDb): Promise<EstimateInput[]> {
  const rows = await db
    .selectDistinctOn([ps.gameId], {
      gameId: ps.gameId,
      date: ps.snapshotDate,
      seconds: ps.playDurationSeconds,
      firstPlayedAt: games.firstPlayedAt,
      lastPlayedAt: games.lastPlayedAt,
    })
    .from(ps)
    .innerJoin(games, eq(games.id, ps.gameId))
    .orderBy(ps.gameId, asc(ps.snapshotDate));
  return rows.map((r) => ({
    gameId: r.gameId,
    firstSnapshotDate: r.date,
    firstSeconds: r.seconds,
    firstPlayedAt: r.firstPlayedAt,
    lastPlayedAt: r.lastPlayedAt,
  }));
}
