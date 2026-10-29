// Выборка «Редких трофеев» (контракт 14.1): одна выборка с LIMIT 5 на список.
import { and, asc, eq, gte, isNotNull, isNull, lt, min, ne, or, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { trophySetCounted } from '@/server/collection/visibility';
import { pickRare, RARE_LIMIT } from './rare';
import type { RareTrophy } from './types';

const { games, gameStatus, gameTrophySets, trophies, trophySets } = schema;

/**
 * range = [fromUtc, toUtc) по earned_at; null = за всё время (включая трофеи без даты).
 * withService (20.8): по умолчанию трофеи игр-сервисов (статус игры сета `service`) не участвуют; сироты и игры без статуса остаются.
 */
export async function getRareTrophies(db: AnyDb, range: { fromUtc: Date; toUtc: Date } | null, limit = RARE_LIMIT, withService = false): Promise<RareTrophy[]> {
  // Игра сета: минимальный id видимой игры (как 11.1, 13.2); сирота = null.
  const owner = db
    .select({ setId: gameTrophySets.trophySetId, gameId: min(gameTrophySets.gameId).as('rare_owner_game_id') })
    .from(gameTrophySets)
    .innerJoin(games, eq(games.id, gameTrophySets.gameId))
    .where(isNull(games.hiddenAt))
    .groupBy(gameTrophySets.trophySetId)
    .as('rare_owner');
  const rows = await db
    .select({
      setId: trophies.trophySetId,
      trophyId: trophies.trophyId,
      type: trophies.type,
      name: trophies.name,
      detail: trophies.detail,
      iconUrl: trophies.iconUrl,
      earnedAt: trophies.earnedAt,
      earnedRate: trophies.earnedRate,
      rarity: trophies.rarity,
      setName: trophySets.name,
      gameId: owner.gameId,
      gameTitle: games.name,
      gameCoverUrl: games.imageUrl,
    })
    .from(trophies)
    .innerJoin(trophySets, eq(trophySets.id, trophies.trophySetId))
    .leftJoin(owner, eq(owner.setId, trophies.trophySetId))
    .leftJoin(games, eq(games.id, owner.gameId))
    .leftJoin(gameStatus, eq(gameStatus.gameId, owner.gameId))
    .where(
      and(
        eq(trophies.earned, true),
        isNotNull(trophies.earnedRate),
        range ? gte(trophies.earnedAt, range.fromUtc) : undefined,
        range ? lt(trophies.earnedAt, range.toUtc) : undefined,
        trophySetCounted(trophies.trophySetId),
        withService ? undefined : or(isNull(gameStatus.status), ne(gameStatus.status, 'service')),
      ),
    )
    .orderBy(asc(trophies.earnedRate), sql`${trophies.earnedAt} asc nulls last`, asc(trophies.trophySetId), asc(trophies.trophyId))
    .limit(limit);
  return pickRare(rows, limit);
}
