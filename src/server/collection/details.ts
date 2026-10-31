// Детали игры для окна (контракт 12.5): GameItem + даты + список трофеев всех сетов игры. Три запроса, без N+1.
import { and, asc, eq, or } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { platinumForecast, setAggsFromTrophies } from './platinum';
import { getGamesByIds } from './query';
import type { GameDetailsResponse, GameTrophyItem } from './types';

const { games, gameStatus, gameTrophySets, trophies } = schema;

export type TrophyRow = {
  setId: number;
  trophyId: number;
  groupId?: string | null;
  type: GameTrophyItem['type'];
  name: string | null;
  detail: string | null;
  iconUrl: string | null;
  hidden: boolean;
  earned: boolean;
  earnedAt: Date | null;
  rarity: number | null;
  /** numeric(5,2) приходит строкой */
  earnedRate: string | null;
};

/** Строка БД -> трофей API. Скрытый и не полученный: name/detail/iconUrl = null (12.5). */
export function toTrophyItem(r: TrophyRow): GameTrophyItem {
  const mask = r.hidden && !r.earned;
  const rate = r.earnedRate === null ? null : Number(r.earnedRate);
  return {
    setId: r.setId,
    trophyId: r.trophyId,
    groupId: r.groupId ?? null,
    type: r.type,
    name: mask ? null : r.name,
    detail: mask ? null : r.detail,
    iconUrl: mask ? null : r.iconUrl,
    hidden: r.hidden,
    earned: r.earned,
    earnedAt: r.earned && r.earnedAt ? r.earnedAt.toISOString() : null,
    rarity: r.rarity,
    earnedRate: rate !== null && Number.isFinite(rate) ? Math.round(rate * 100) / 100 : null,
  };
}

/** null, если игры нет. Скрытые игры отдаются (hiddenAt не null). */
export async function getGameDetails(db: AnyDb, userId: UserId, id: number): Promise<GameDetailsResponse | null> {
  const [[game], [meta], rows] = await Promise.all([
    getGamesByIds(db, userId, [id]).then((g) => [g[0]] as const),
    db
      .select({ firstPlayedAt: games.firstPlayedAt, statusChangedAt: gameStatus.statusChangedAt })
      .from(games)
      .leftJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
      .where(and(eq(games.id, id), eq(games.userId, userId)))
      .limit(1)
      .then((m) => [m[0]] as const),
    db
      .selectDistinct({
        setId: trophies.trophySetId,
        trophyId: trophies.trophyId,
        groupId: trophies.groupId,
        type: trophies.type,
        name: trophies.name,
        detail: trophies.detail,
        iconUrl: trophies.iconUrl,
        hidden: trophies.hidden,
        earned: trophies.earned,
        earnedAt: trophies.earnedAt,
        rarity: trophies.rarity,
        earnedRate: trophies.earnedRate,
      })
      .from(gameTrophySets)
      .innerJoin(trophies, and(eq(trophies.trophySetId, gameTrophySets.trophySetId), eq(trophies.userId, userId)))
      .innerJoin(games, and(eq(games.id, gameTrophySets.gameId), eq(games.userId, userId)))
      // 25.3: трофеи всей группы (сама игра и её дубли); сет, привязанный к нескольким версиям, не задваивается (distinct)
      .where(and(eq(gameTrophySets.userId, userId), or(eq(games.id, id), eq(games.duplicateOfGameId, id))))
      .orderBy(asc(trophies.trophySetId), asc(trophies.trophyId)),
  ]);
  if (!game || !meta) return null;
  const trophyList = rows.map(toTrophyItem);
  return {
    game,
    firstPlayedAt: meta.firstPlayedAt ? meta.firstPlayedAt.toISOString() : null,
    statusChangedAt: meta.statusChangedAt ? meta.statusChangedAt.toISOString() : null,
    trophyList,
    // 14.2: из уже загруженного списка, без нового запроса
    platinumForecast: platinumForecast(setAggsFromTrophies(trophyList)),
  };
}
