// Чтение данных для /api/stats (контракт 10). Расчёты в чистых модулях, здесь только выборки.
import { and, desc, eq, gte, isNotNull, isNull, lt, min, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { getGamesByIds } from '@/server/collection/query';
import { gameVisible, trophySetCounted } from '@/server/collection/visibility';
import { composeStats } from './compose';
import { getEstimateInputs } from './estimate-query';
import { applyExclusions, getMonthExclusions } from './exclusions';
import type { FinishedEvent } from './finished';
import { calcHours, estimateYears, groupSnapshots, type EstimateInput, type Snapshot } from './hours';
import { mskDateString, mskMidnightUtc, resolvePeriod, ymd } from './period';
import { playedGameIds } from './played';
import { getRareTrophies } from './rare-query';
import { rankByHours, rankByTrophies, type GameTrophyCount } from './top';
import type { EarnedTrophy } from './trophies';
import type { StatsResponse } from './types';
import type { StatsQuery } from './validation';

const { games, gameStatus, gameTrophySets, playtimeSnapshots: ps, trophies } = schema;
const TZ = 'Europe/Moscow';

export async function getStatsYears(db: AnyDb, userId: UserId, currentYear: number, estimates: readonly EstimateInput[] = []): Promise<number[]> {
  const yearOf = (col: unknown) => sql<number | null>`extract(year from (${col} at time zone ${TZ}))::int`;
  const [snap, tr, comp, drop] = await Promise.all([
    db.selectDistinct({ y: sql<number>`extract(year from ${ps.snapshotDate})::int` }).from(ps).where(and(eq(ps.userId, userId), gameVisible(ps.gameId, userId))),
    db.selectDistinct({ y: yearOf(trophies.earnedAt) }).from(trophies).where(and(eq(trophies.userId, userId), isNotNull(trophies.earnedAt), trophySetCounted(trophies.trophySetId, userId))),
    db.selectDistinct({ y: yearOf(gameStatus.completedAt) }).from(gameStatus).where(and(eq(gameStatus.userId, userId), isNotNull(gameStatus.completedAt), gameVisible(gameStatus.gameId, userId))),
    db.selectDistinct({ y: yearOf(gameStatus.droppedAt) }).from(gameStatus).where(and(eq(gameStatus.userId, userId), isNotNull(gameStatus.droppedAt), gameVisible(gameStatus.gameId, userId))),
  ]);
  const set = new Set<number>([currentYear]);
  for (const r of [...snap, ...tr, ...comp, ...drop]) if (r.y !== null) set.add(r.y);
  for (const y of estimateYears(estimates)) set.add(y);
  return [...set].sort((a, b) => b - a);
}

export async function getStats(db: AnyDb, userId: UserId, q: StatsQuery, now: Date = new Date()): Promise<StatsResponse> {
  const today = mskDateString(now);
  const currentYear = Number(today.slice(0, 4));
  const period = resolvePeriod(q.type, q.year, q.month);
  const yearFrom = ymd(q.year, 1, 1);
  const yearTo = ymd(q.year, 12, 31);
  const yearStartUtc = mskMidnightUtc(q.year, 1, 1);
  const yearEndUtc = mskMidnightUtc(q.year + 1, 1, 1);
  const fromUtc = new Date(period.fromUtc);
  const toUtc = new Date(period.toUtc);

  // 15.1: исключения грузятся параллельно со входами оценки и накладываются чистой функцией
  const [exclusions, rawEstimates] = await Promise.all([getMonthExclusions(db, userId), getEstimateInputs(db, userId, new Map())]);
  const estimates = applyExclusions(rawEstimates, exclusions);
  const owner = db
    .select({ setId: gameTrophySets.trophySetId, gameId: min(gameTrophySets.gameId).as('owner_game_id') })
    .from(gameTrophySets)
    .innerJoin(games, eq(games.id, gameTrophySets.gameId))
    .where(and(eq(gameTrophySets.userId, userId), eq(games.userId, userId), isNull(games.hiddenAt)))
    .groupBy(gameTrophySets.trophySetId)
    .as('owner');
  const [years, inYear, bases, first, trophyRows, completedRows, droppedRows, genreRows, trophyByGameRows, rarePeriod, rareAllTime] = await Promise.all([
    getStatsYears(db, userId, currentYear, estimates),
    db
      .select({ gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(eq(ps.userId, userId), gte(ps.snapshotDate, yearFrom), sql`${ps.snapshotDate} <= ${yearTo}`, gameVisible(ps.gameId, userId))),
    db
      .selectDistinctOn([ps.gameId], { gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(eq(ps.userId, userId), lt(ps.snapshotDate, yearFrom), gameVisible(ps.gameId, userId)))
      .orderBy(ps.gameId, desc(ps.snapshotDate)),
    db.select({ d: sql<string | null>`min(${ps.snapshotDate})` }).from(ps).where(eq(ps.userId, userId)),
    db
      .select({ type: trophies.type, earnedAt: trophies.earnedAt })
      .from(trophies)
      .where(and(eq(trophies.userId, userId), eq(trophies.earned, true), gte(trophies.earnedAt, yearStartUtc), lt(trophies.earnedAt, yearEndUtc), trophySetCounted(trophies.trophySetId, userId))),
    db
      .select({ gameId: gameStatus.gameId, at: gameStatus.completedAt })
      .from(gameStatus)
      .where(and(eq(gameStatus.userId, userId), eq(gameStatus.status, 'completed'), gte(gameStatus.completedAt, fromUtc), lt(gameStatus.completedAt, toUtc), gameVisible(gameStatus.gameId, userId))),
    db
      .select({ gameId: gameStatus.gameId, at: gameStatus.droppedAt })
      .from(gameStatus)
      .where(and(eq(gameStatus.userId, userId), eq(gameStatus.status, 'dropped'), gte(gameStatus.droppedAt, fromUtc), lt(gameStatus.droppedAt, toUtc), gameVisible(gameStatus.gameId, userId))),
    db
      .select({ id: games.id, title: games.name, coverUrl: games.imageUrl, psnGenres: games.psnGenres, genresOverride: games.genresOverride })
      .from(games)
      .where(and(eq(games.userId, userId), isNull(games.hiddenAt))),
    // 13.2: трофеи периода по играм одним запросом. Игра сета = минимальный id видимой игры (как в Итогах); сеты-сироты и сеты скрытых игр отпадают на inner join.
    db
      .select({ gameId: owner.gameId, type: trophies.type, n: sql<number>`count(*)::int` })
      .from(trophies)
      .innerJoin(owner, eq(owner.setId, trophies.trophySetId))
      .where(and(eq(trophies.userId, userId), eq(trophies.earned, true), gte(trophies.earnedAt, fromUtc), lt(trophies.earnedAt, toUtc)))
      .groupBy(owner.gameId, trophies.type),
    // 14.1: по LIMIT 5 строк, без GameItem (вес ответа, P8-3).
    getRareTrophies(db, userId, { fromUtc, toUtc }, undefined, q.withService === true),
    getRareTrophies(db, userId, null, undefined, q.withService === true),
  ]);

  const finishedEvents: FinishedEvent[] = [
    ...completedRows.flatMap((r) => (r.at ? [{ gameId: r.gameId, kind: 'completed' as const, at: r.at }] : [])),
    ...droppedRows.flatMap((r) => (r.at ? [{ gameId: r.gameId, kind: 'dropped' as const, at: r.at }] : [])),
  ];
  const snapshots: Snapshot[] = [...bases, ...inYear];
  // Карточки одним запросом: завершённые в периоде + все игры блока «Игры месяца» (без N+1).
  const by = groupSnapshots(snapshots);
  const firstSnapshotDate = first[0]?.d ?? null;
  const hours = calcHours({ by, estimates, period, year: q.year, firstSnapshotDate, today });
  const titles = new Map(genreRows.map((g) => [g.id, g.title] as const));
  const trophiesByGame: GameTrophyCount[] = trophyByGameRows.flatMap((r) => (r.gameId === null ? [] : [{ gameId: r.gameId, type: r.type, n: r.n }]));
  // Топ-10 (13.2) тоже грузится этим же запросом карточек.
  const ids = new Set<number>(playedGameIds({ by, estimates, period, finishedEvents, exclusions }));
  for (const r of rankByHours(hours.seconds, hours.estimatedSeconds, titles)) ids.add(r.gameId);
  for (const r of rankByTrophies(trophiesByGame, titles)) ids.add(r.gameId);
  const items = await getGamesByIds(db, userId, [...ids]);
  const earned: EarnedTrophy[] = trophyRows;
  const genreGames = new Map(genreRows.map((g) => [g.id, g] as const));

  return composeStats({
    period,
    today,
    years,
    snapshots,
    estimates,
    firstSnapshotDate,
    hours,
    trophiesByGame,
    trophies: earned,
    finishedEvents,
    gameById: new Map(items.map((g) => [g.id, g])),
    genreGames,
    rareTrophies: { period: rarePeriod, allTime: rareAllTime },
    exclusions,
  });
}
