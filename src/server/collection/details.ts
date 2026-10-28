// Детали игры для окна (контракт 12.5): GameItem + даты + список трофеев всех сетов игры. Три запроса, без N+1.
import { asc, eq } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { getGamesByIds } from './query';
import type { GameDetailsResponse, GameTrophyItem } from './types';

const { games, gameStatus, gameTrophySets, trophies } = schema;

export type TrophyRow = {
  setId: number;
  trophyId: number;
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

/** Строка БД -> трофей API. Скрытый и не полученный: name/detail = null (12.5). */
export function toTrophyItem(r: TrophyRow): GameTrophyItem {
  const mask = r.hidden && !r.earned;
  const rate = r.earnedRate === null ? null : Number(r.earnedRate);
  return {
    setId: r.setId,
    trophyId: r.trophyId,
    type: r.type,
    name: mask ? null : r.name,
    detail: mask ? null : r.detail,
    iconUrl: r.iconUrl,
    hidden: r.hidden,
    earned: r.earned,
    earnedAt: r.earned && r.earnedAt ? r.earnedAt.toISOString() : null,
    rarity: r.rarity,
    earnedRate: rate !== null && Number.isFinite(rate) ? Math.round(rate * 100) / 100 : null,
  };
}

/** null, если игры нет. Скрытые игры отдаются (hiddenAt не null). */
export async function getGameDetails(db: AnyDb, id: number): Promise<GameDetailsResponse | null> {
  const [[game], [meta], rows] = await Promise.all([
    getGamesByIds(db, [id]).then((g) => [g[0]] as const),
    db
      .select({ firstPlayedAt: games.firstPlayedAt, statusChangedAt: gameStatus.statusChangedAt })
      .from(games)
      .leftJoin(gameStatus, eq(gameStatus.gameId, games.id))
      .where(eq(games.id, id))
      .limit(1)
      .then((m) => [m[0]] as const),
    db
      .select({
        setId: trophies.trophySetId,
        trophyId: trophies.trophyId,
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
      .innerJoin(trophies, eq(trophies.trophySetId, gameTrophySets.trophySetId))
      .where(eq(gameTrophySets.gameId, id))
      .orderBy(asc(trophies.trophySetId), asc(trophies.trophyId)),
  ]);
  if (!game || !meta) return null;
  return {
    game,
    firstPlayedAt: meta.firstPlayedAt ? meta.firstPlayedAt.toISOString() : null,
    statusChangedAt: meta.statusChangedAt ? meta.statusChangedAt.toISOString() : null,
    trophyList: rows.map(toTrophyItem),
  };
}
