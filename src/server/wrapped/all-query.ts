// Чтение данных для /api/wrapped?year=all (контракт 26.2). Числа берутся из Статистики «за всё время» (stats/all-query).
import { toHttps } from '@/shared/https-url';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { getPsnProfile } from '@/server/collection/profile';
import { getGamesByIds } from '@/server/collection/query';
import { effectiveGameIdSql, snapshotGameVisible, trophySetCounted, visibleGameRow } from '@/server/collection/visibility';
import { loadAllTime } from '@/server/stats/all-query';
import type { AllPeriod, StatsResponse } from '@/server/stats/types';
import { getWrappedYears } from './years-query';
import { composeWrappedAll, type FirstGame } from './all-compose';
import type { WrappedPlatinum, WrappedResponse } from './types';
import { mskDateString } from '@/server/stats/period';
import { getEstimateInputs } from '@/server/stats/estimate-query';

const { games, gameTrophySets, trophies, trophySets } = schema;

export async function getWrappedAll(db: AnyDb, userId: UserId, onlineId: string | null, now: Date = new Date(), withService = false, tz?: string): Promise<WrappedResponse> {
  const currentYear = Number(mskDateString(now).slice(0, 4));
  const data = await loadAllTime(db, userId, now, withService, tz);
  const firstPlayed = sql<Date | null>`least("games"."first_played_at", (select min(d."first_played_at") from "games" d where d."user_id" = "games"."user_id" and d."duplicate_of_game_id" = "games"."id"))`;
  const counted = and(eq(trophies.userId, userId), eq(trophies.earned, true), isNotNull(trophies.earnedAt), trophySetCounted(trophies.trophySetId, userId));
  const [estimates, psnProf, platRows, firstPlayedRows, firstTrophyRows] = await Promise.all([
    getEstimateInputs(db, userId),
    getPsnProfile(db, userId),
    db
      .select({ setId: trophies.trophySetId, at: trophies.earnedAt, name: trophies.name, earnedRate: trophies.earnedRate, rarity: trophies.rarity, setName: trophySets.name })
      .from(trophies)
      .innerJoin(trophySets, and(eq(trophySets.id, trophies.trophySetId), eq(trophySets.userId, userId)))
      .where(and(counted, eq(trophies.type, 'platinum'))),
    // первая игра: самая ранняя дата первого запуска среди главной и её дублей
    db
      .select({ id: games.id, at: firstPlayed })
      .from(games)
      .where(and(eq(games.userId, userId), visibleGameRow(), sql`${firstPlayed} is not null`))
      .orderBy(asc(firstPlayed), asc(games.id))
      .limit(1),
    // запасной источник: самый ранний полученный трофей
    db.select({ setId: trophies.trophySetId, at: trophies.earnedAt }).from(trophies).where(counted).orderBy(asc(trophies.earnedAt), asc(trophies.trophySetId), asc(trophies.trophyId)).limit(1),
  ]);
  const years = await getWrappedYears(db, userId, currentYear, estimates);

  // Игра сета: минимальный id видимой игры (как в годовых Итогах). Один запрос на сеты платин и первого трофея.
  const setIds = [...new Set([...platRows.map((r) => r.setId), ...firstTrophyRows.map((r) => r.setId)])];
  const links = setIds.length
    ? await db
        .select({ setId: gameTrophySets.trophySetId, gameId: sql<number>`min(${effectiveGameIdSql('games')})` })
        .from(gameTrophySets)
        .innerJoin(games, and(eq(games.id, gameTrophySets.gameId), eq(games.userId, userId)))
        .where(and(eq(gameTrophySets.userId, userId), inArray(gameTrophySets.trophySetId, setIds), snapshotGameVisible(gameTrophySets.gameId, userId)))
        .groupBy(gameTrophySets.trophySetId)
    : [];
  const gameBySet = new Map(links.map((l) => [l.setId, l.gameId]));
  const firstTrophyGameId = firstTrophyRows[0] ? gameBySet.get(firstTrophyRows[0].setId) ?? null : null;
  const needed = new Set<number>();
  for (const id of gameBySet.values()) if (id !== null) needed.add(id);
  for (const r of firstPlayedRows) needed.add(r.id);
  const missing = [...needed].filter((id) => !data.gameById.has(id));
  const extra = missing.length ? await getGamesByIds(db, userId, missing) : [];
  const gameById = new Map([...data.gameById, ...extra.map((g) => [g.id, g] as const)]);

  const platinums: WrappedPlatinum[] = platRows.flatMap((r) => {
    if (!r.at) return [];
    const gid = gameBySet.get(r.setId);
    return [{ at: r.at.toISOString(), name: r.name, earnedRate: r.earnedRate === null ? null : Number(r.earnedRate), rarity: r.rarity, setName: r.setName, game: (gid !== undefined && gid !== null ? gameById.get(gid) : undefined) ?? null }];
  });

  let firstGame: FirstGame | null = null;
  const fp = firstPlayedRows[0];
  if (fp?.at) firstGame = { at: new Date(fp.at), source: 'first_played', game: gameById.get(fp.id) ?? null };
  else if (firstTrophyRows[0]?.at) firstGame = { at: firstTrophyRows[0].at, source: 'first_trophy', game: firstTrophyGameId === null ? null : gameById.get(firstTrophyGameId) ?? null };

  const stats = data.response as StatsResponse & { period: AllPeriod };
  const res = composeWrappedAll({
    stats,
    games: data.games,
    gameById,
    years,
    onlineId: onlineId ?? psnProf?.onlineId ?? null,
    avatarUrl: toHttps(psnProf?.avatarUrl),
    platinums,
    firstGame,
    patternCells: data.patternCells,
  });
  return res;
}
