// Чтение данных для /api/stats?period=all (контракт 26.1). Число запросов фиксировано и не зависит от числа игр и снимков.
import { and, asc, desc, eq, isNotNull, max, min, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { getGamesByIds } from '@/server/collection/query';
import type { GameItem } from '@/server/collection/types';
import { effectiveGameIdSql, gameVisible, snapshotGameVisible, trophySetCounted, visibleGameRow } from '@/server/collection/visibility';
import { allPeriod, calcHoursByYear, composeStatsAll, topIds, type AllGameRow, type FinishedYearRow, type HoursByYearResult, type TrophyYearRow } from './all-time';
import { getDuplicateMap } from './duplicates';
import { getEstimateInputs } from './estimate-query';
import { applyExclusions, getMonthExclusions } from './exclusions';
import { mskDateString } from './period';
import { getPlayPatternCells } from './play-pattern-query';
import { getRareTrophies } from './rare-query';
import type { PatternCell } from './play-pattern';
import type { GameTrophyCount } from './top';
import type { StatsResponse } from './types';
import { getStatsYears } from './years-query';

const { games, gameStatus, gameTrophySets, playtimeSnapshots: ps, trophies } = schema;
// Литерал, а не параметр: выражение в SELECT и GROUP BY должно совпадать дословно.
const MSK = sql.raw(`'Europe/Moscow'`);

/**
 * 25.3: часы карточки = свои + часы её дублей. Имена столбцов с таблицей явно: drizzle в списке SELECT одной таблицы
 * печатает их без префикса, и подзапрос по дублям тогда смотрел бы на самого себя.
 */
export const effectiveSecondsQualified = sql<number>`("games"."play_duration_seconds" + coalesce((select sum(d."play_duration_seconds") from "games" d where d."user_id" = "games"."user_id" and d."duplicate_of_game_id" = "games"."id"), 0))::int`;

const asDate = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));

export type AllTimeData = {
  response: StatsResponse;
  hours: HoursByYearResult;
  games: AllGameRow[];
  patternCells: PatternCell[];
  /** первая/последняя даты данных МСК */
  first: string | null;
  last: string | null;
};

/** Всё, что нужно и Статистике, и Итогам «за всё время». gameById: карточки игр из топов. */
export async function loadAllTime(db: AnyDb, userId: UserId, now: Date = new Date(), withService = false): Promise<AllTimeData & { gameById: Map<number, GameItem> }> {
  const today = mskDateString(now);
  const currentYear = Number(today.slice(0, 4));
  const [exclusions, rawEstimates, dup] = await Promise.all([getMonthExclusions(db, userId), getEstimateInputs(db, userId, new Map()), getDuplicateMap(db, userId)]);
  const estimates = applyExclusions(rawEstimates, exclusions);

  const trophyYear = sql<number>`extract(year from (${trophies.earnedAt} at time zone ${MSK}))::int`;
  const snapYear = sql<number>`extract(year from ${ps.snapshotDate})::int`;
  const finishedAt = sql`case when ${gameStatus.status} = 'completed' then ${gameStatus.completedAt} else ${gameStatus.droppedAt} end`;
  const finishedYear = sql<number>`extract(year from (${finishedAt} at time zone ${MSK}))::int`;
  const owner = db
    .select({ setId: gameTrophySets.trophySetId, gameId: sql<number>`min(${effectiveGameIdSql('games')})`.as('owner_game_id') })
    .from(gameTrophySets)
    .innerJoin(games, eq(games.id, gameTrophySets.gameId))
    .where(and(eq(gameTrophySets.userId, userId), eq(games.userId, userId), snapshotGameVisible(games.id, userId)))
    .groupBy(gameTrophySets.trophySetId)
    .as('owner');
  const snapVisible = and(eq(ps.userId, userId), snapshotGameVisible(ps.gameId, userId));

  const [years, firstRows, endRows, firstSnap, totals, trophyRows, finishedRows, gameRows, trophyByGameRows, rare, cells, rSnap, rTroph, rStatus, rGames] = await Promise.all([
    getStatsYears(db, userId, currentYear, estimates),
    db
      .selectDistinctOn([ps.gameId], { gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(snapVisible)
      .orderBy(ps.gameId, asc(ps.snapshotDate)),
    db
      .selectDistinctOn([ps.gameId, snapYear], { gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(snapVisible)
      .orderBy(ps.gameId, snapYear, desc(ps.snapshotDate)),
    db.select({ d: sql<string | null>`min(${ps.snapshotDate})` }).from(ps).where(eq(ps.userId, userId)),
    db
      .select({ n: sql<number>`count(*)::int`, sec: sql<number>`coalesce(sum(${effectiveSecondsQualified}), 0)::float8` })
      .from(games)
      .where(and(eq(games.userId, userId), visibleGameRow())),
    db
      .select({ year: trophyYear, type: trophies.type, n: sql<number>`count(*)::int` })
      .from(trophies)
      .where(and(eq(trophies.userId, userId), eq(trophies.earned, true), isNotNull(trophies.earnedAt), trophySetCounted(trophies.trophySetId, userId)))
      .groupBy(trophyYear, trophies.type),
    db
      .select({ year: finishedYear, kind: gameStatus.status, n: sql<number>`count(*)::int` })
      .from(gameStatus)
      .where(and(eq(gameStatus.userId, userId), sql`${finishedAt} is not null`, sql`${gameStatus.status} in ('completed', 'dropped')`, gameVisible(gameStatus.gameId, userId)))
      .groupBy(finishedYear, gameStatus.status),
    db
      .select({
        id: games.id,
        title: games.name,
        coverUrl: games.imageUrl,
        psnGenres: games.psnGenres,
        genresOverride: games.genresOverride,
        seconds: effectiveSecondsQualified,
        status: gameStatus.status,
      })
      .from(games)
      .leftJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
      .where(and(eq(games.userId, userId), visibleGameRow())),
    db
      .select({ gameId: owner.gameId, type: trophies.type, n: sql<number>`count(*)::int` })
      .from(trophies)
      .innerJoin(owner, eq(owner.setId, trophies.trophySetId))
      .where(and(eq(trophies.userId, userId), eq(trophies.earned, true)))
      .groupBy(owner.gameId, trophies.type),
    getRareTrophies(db, userId, null, undefined, withService),
    getPlayPatternCells(db, userId, null),
    // границы данных (первая и последняя даты)
    db.select({ lo: min(ps.snapshotDate), hi: max(ps.snapshotDate) }).from(ps).where(snapVisible),
    db
      .select({ lo: min(trophies.earnedAt), hi: max(trophies.earnedAt) })
      .from(trophies)
      .where(and(eq(trophies.userId, userId), eq(trophies.earned, true), isNotNull(trophies.earnedAt), trophySetCounted(trophies.trophySetId, userId))),
    db
      .select({ cLo: min(gameStatus.completedAt), cHi: max(gameStatus.completedAt), dLo: min(gameStatus.droppedAt), dHi: max(gameStatus.droppedAt) })
      .from(gameStatus)
      .where(and(eq(gameStatus.userId, userId), gameVisible(gameStatus.gameId, userId))),
    db
      .select({ lo: min(games.firstPlayedAt), hi: max(games.lastPlayedAt) })
      .from(games)
      .where(and(eq(games.userId, userId), visibleGameRow())),
  ]);

  const total = totals[0]?.n ? totals[0].sec : null;
  const hours = calcHoursByYear({ points: [...firstRows, ...endRows], estimates, dup, totalSeconds: total, years });
  const gameList: AllGameRow[] = gameRows.map((g) => ({
    id: g.id,
    title: g.title,
    coverUrl: g.coverUrl,
    psnGenres: g.psnGenres,
    genresOverride: g.genresOverride,
    seconds: g.seconds,
    finishedEver: g.status === 'completed' || g.status === 'dropped',
  }));
  const trophyYears: TrophyYearRow[] = trophyRows.flatMap((r) => (r.year === null ? [] : [{ year: r.year, type: r.type, n: r.n }]));
  const finishedYears: FinishedYearRow[] = finishedRows.flatMap((r) => (r.year === null || (r.kind !== 'completed' && r.kind !== 'dropped') ? [] : [{ year: r.year, kind: r.kind, n: r.n }]));
  const byGame: GameTrophyCount[] = trophyByGameRows.flatMap((r) => (r.gameId === null ? [] : [{ gameId: r.gameId, type: r.type, n: r.n }]));

  const dates: string[] = [];
  const addDate = (v: unknown, isDateString = false) => {
    if (v === null || v === undefined) return;
    if (isDateString) dates.push(String(v).slice(0, 10));
    else {
      const d = asDate(v);
      if (d) dates.push(mskDateString(d));
    }
  };
  addDate(rSnap[0]?.lo, true);
  addDate(rSnap[0]?.hi, true);
  for (const v of [rTroph[0]?.lo, rTroph[0]?.hi, rStatus[0]?.cLo, rStatus[0]?.cHi, rStatus[0]?.dLo, rStatus[0]?.dHi, rGames[0]?.lo, rGames[0]?.hi]) addDate(v);
  dates.sort();
  const first = dates[0] ?? null;
  const last = dates[dates.length - 1] ?? null;

  const ids = new Set<number>(topIds(gameList, byGame));
  const items = await getGamesByIds(db, userId, [...ids]);
  const gameById = new Map(items.map((g) => [g.id, g]));
  const response = composeStatsAll({
    period: allPeriod(currentYear, first, last),
    years,
    firstSnapshotDate: firstSnap[0]?.d ?? null,
    hours,
    trophyYears,
    finishedYears,
    games: gameList,
    trophiesByGame: byGame,
    gameById,
    rare,
    patternCells: cells,
  });
  return { response, hours, games: gameList, patternCells: cells, first, last, gameById };
}

export async function getStatsAll(db: AnyDb, userId: UserId, now: Date = new Date(), withService = false): Promise<StatsResponse> {
  return (await loadAllTime(db, userId, now, withService)).response;
}
