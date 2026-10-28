// Выборка для «ближе всего к платине» (контракт 14.2, базовая группа: 15.3): одна сгруппированная выборка по (игра, сет), расчёт в platinum.ts.
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { platinumForecast, rankNearPlatinum, type NearPlatinumCandidate, type SetAgg } from './platinum';

const { games, gameStatus, gameTrophySets, trophies } = schema;

/** Видимые игры со статусом не dropped (без статуса тоже), топ по прогрессу к платине. Только id и прогнозы. */
export async function getNearPlatinumCandidates(db: AnyDb, limit?: number): Promise<NearPlatinumCandidate[]> {
  const cnt = (cond: ReturnType<typeof sql>) => sql<number>`(count(*) filter (where ${cond}))::int`;
  // 15.3: прогноз по базовой группе (default или ещё неизвестная); DLC считается отдельно
  const base = sql`(${trophies.groupId} is null or ${trophies.groupId} = 'default')`;
  const dlc = sql`${trophies.groupId} is not null and ${trophies.groupId} <> 'default' and ${trophies.type} <> 'platinum'`;
  const remaining = sql`${base} and not ${trophies.earned} and ${trophies.type} <> 'platinum'`;
  const rows = await db
    .select({
      gameId: gameTrophySets.gameId,
      title: games.name,
      setId: trophies.trophySetId,
      pD: cnt(sql`${trophies.type} = 'platinum'`),
      pE: cnt(sql`${trophies.type} = 'platinum' and ${trophies.earned}`),
      pRate: sql<string | null>`max(${trophies.earnedRate}) filter (where ${trophies.type} = 'platinum')`,
      gD: cnt(sql`${base} and ${trophies.type} = 'gold'`),
      sD: cnt(sql`${base} and ${trophies.type} = 'silver'`),
      bD: cnt(sql`${base} and ${trophies.type} = 'bronze'`),
      gE: cnt(sql`${base} and ${trophies.type} = 'gold' and ${trophies.earned}`),
      sE: cnt(sql`${base} and ${trophies.type} = 'silver' and ${trophies.earned}`),
      bE: cnt(sql`${base} and ${trophies.type} = 'bronze' and ${trophies.earned}`),
      unknown: cnt(sql`${trophies.groupId} is null and ${trophies.type} <> 'platinum'`),
      dlcD: cnt(dlc),
      dlcE: cnt(sql`${dlc} and ${trophies.earned}`),
      hidden: cnt(sql`${remaining} and ${trophies.hidden}`),
      rateSum: sql<string | null>`sum(${trophies.earnedRate}) filter (where ${remaining})`,
      rateCount: sql<number>`(count(${trophies.earnedRate}) filter (where ${remaining}))::int`,
      rateMin: sql<string | null>`min(${trophies.earnedRate}) filter (where ${remaining})`,
    })
    .from(gameTrophySets)
    .innerJoin(games, eq(games.id, gameTrophySets.gameId))
    .leftJoin(gameStatus, eq(gameStatus.gameId, games.id))
    .innerJoin(trophies, eq(trophies.trophySetId, gameTrophySets.trophySetId))
    .where(and(isNull(games.hiddenAt), or(isNull(gameStatus.status), ne(gameStatus.status, 'dropped'))))
    .groupBy(gameTrophySets.gameId, games.name, trophies.trophySetId);

  const num = (v: string | number | null) => (v === null ? null : Number(v));
  const byGame = new Map<number, { title: string; sets: SetAgg[] }>();
  for (const r of rows) {
    const g = byGame.get(r.gameId) ?? { title: r.title, sets: [] };
    byGame.set(r.gameId, g);
    g.sets.push({
      setId: r.setId,
      platinumDefined: r.pD,
      platinumEarned: r.pE,
      platinumEarnedRate: num(r.pRate),
      defined: { gold: r.gD, silver: r.sD, bronze: r.bD },
      earned: { gold: r.gE, silver: r.sE, bronze: r.bE },
      remainingHidden: r.hidden,
      rateSum: num(r.rateSum) ?? 0,
      rateCount: r.rateCount,
      rateMin: num(r.rateMin),
      groupUnknown: r.unknown,
      dlcDefined: r.dlcD,
      dlcEarned: r.dlcE,
    });
  }
  const candidates: NearPlatinumCandidate[] = [];
  for (const [gameId, g] of byGame) {
    const forecast = platinumForecast(g.sets);
    if (forecast) candidates.push({ gameId, title: g.title, forecast });
  }
  return rankNearPlatinum(candidates, limit);
}
