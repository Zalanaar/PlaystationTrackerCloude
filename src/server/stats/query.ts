// Чтение данных для /api/stats (контракт 10). Расчёты в чистых модулях, здесь только выборки.
import { and, desc, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { getGamesByIds } from '@/server/collection/query';
import { gameVisible, trophySetCounted } from '@/server/collection/visibility';
import { composeStats } from './compose';
import { getEstimateInputs } from './estimate-query';
import type { FinishedEvent } from './finished';
import type { GenreGame } from './genre-stats';
import { estimateYears, groupSnapshots, type EstimateInput, type Snapshot } from './hours';
import { mskDateString, mskMidnightUtc, resolvePeriod, ymd } from './period';
import { playedGameIds } from './played';
import type { EarnedTrophy } from './trophies';
import type { StatsResponse } from './types';
import type { StatsQuery } from './validation';

const { games, gameStatus, playtimeSnapshots: ps, trophies } = schema;
const TZ = 'Europe/Moscow';

export async function getStatsYears(db: AnyDb, currentYear: number, estimates: readonly EstimateInput[] = []): Promise<number[]> {
  const yearOf = (col: unknown) => sql<number | null>`extract(year from (${col} at time zone ${TZ}))::int`;
  const [snap, tr, comp, drop] = await Promise.all([
    db.selectDistinct({ y: sql<number>`extract(year from ${ps.snapshotDate})::int` }).from(ps).where(gameVisible(ps.gameId)),
    db.selectDistinct({ y: yearOf(trophies.earnedAt) }).from(trophies).where(and(isNotNull(trophies.earnedAt), trophySetCounted(trophies.trophySetId))),
    db.selectDistinct({ y: yearOf(gameStatus.completedAt) }).from(gameStatus).where(and(isNotNull(gameStatus.completedAt), gameVisible(gameStatus.gameId))),
    db.selectDistinct({ y: yearOf(gameStatus.droppedAt) }).from(gameStatus).where(and(isNotNull(gameStatus.droppedAt), gameVisible(gameStatus.gameId))),
  ]);
  const set = new Set<number>([currentYear]);
  for (const r of [...snap, ...tr, ...comp, ...drop]) if (r.y !== null) set.add(r.y);
  for (const y of estimateYears(estimates)) set.add(y);
  return [...set].sort((a, b) => b - a);
}

export async function getStats(db: AnyDb, q: StatsQuery, now: Date = new Date()): Promise<StatsResponse> {
  const today = mskDateString(now);
  const currentYear = Number(today.slice(0, 4));
  const period = resolvePeriod(q.type, q.year, q.month);
  const yearFrom = ymd(q.year, 1, 1);
  const yearTo = ymd(q.year, 12, 31);
  const yearStartUtc = mskMidnightUtc(q.year, 1, 1);
  const yearEndUtc = mskMidnightUtc(q.year + 1, 1, 1);
  const fromUtc = new Date(period.fromUtc);
  const toUtc = new Date(period.toUtc);

  const estimates = await getEstimateInputs(db);
  const [years, inYear, bases, first, trophyRows, completedRows, droppedRows, genreRows] = await Promise.all([
    getStatsYears(db, currentYear, estimates),
    db
      .select({ gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(gte(ps.snapshotDate, yearFrom), sql`${ps.snapshotDate} <= ${yearTo}`, gameVisible(ps.gameId))),
    db
      .selectDistinctOn([ps.gameId], { gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(lt(ps.snapshotDate, yearFrom), gameVisible(ps.gameId)))
      .orderBy(ps.gameId, desc(ps.snapshotDate)),
    db.select({ d: sql<string | null>`min(${ps.snapshotDate})` }).from(ps),
    db
      .select({ type: trophies.type, earnedAt: trophies.earnedAt })
      .from(trophies)
      .where(and(eq(trophies.earned, true), gte(trophies.earnedAt, yearStartUtc), lt(trophies.earnedAt, yearEndUtc), trophySetCounted(trophies.trophySetId))),
    db
      .select({ gameId: gameStatus.gameId, at: gameStatus.completedAt })
      .from(gameStatus)
      .where(and(eq(gameStatus.status, 'completed'), gte(gameStatus.completedAt, fromUtc), lt(gameStatus.completedAt, toUtc), gameVisible(gameStatus.gameId))),
    db
      .select({ gameId: gameStatus.gameId, at: gameStatus.droppedAt })
      .from(gameStatus)
      .where(and(eq(gameStatus.status, 'dropped'), gte(gameStatus.droppedAt, fromUtc), lt(gameStatus.droppedAt, toUtc), gameVisible(gameStatus.gameId))),
    db.select({ id: games.id, psnGenres: games.psnGenres, genresOverride: games.genresOverride }).from(games).where(isNull(games.hiddenAt)),
  ]);

  const finishedEvents: FinishedEvent[] = [
    ...completedRows.flatMap((r) => (r.at ? [{ gameId: r.gameId, kind: 'completed' as const, at: r.at }] : [])),
    ...droppedRows.flatMap((r) => (r.at ? [{ gameId: r.gameId, kind: 'dropped' as const, at: r.at }] : [])),
  ];
  const snapshots: Snapshot[] = [...bases, ...inYear];
  // Карточки одним запросом: завершённые в периоде + все игры блока «Игры месяца» (без N+1).
  const ids = playedGameIds({ by: groupSnapshots(snapshots), estimates, period, finishedEvents });
  const items = await getGamesByIds(db, ids);
  const earned: EarnedTrophy[] = trophyRows;
  const genreGames = new Map<number, GenreGame>(genreRows.map((g) => [g.id, g]));

  return composeStats({
    period,
    today,
    years,
    snapshots,
    estimates,
    firstSnapshotDate: first[0]?.d ?? null,
    trophies: earned,
    finishedEvents,
    gameById: new Map(items.map((g) => [g.id, g])),
    genreGames,
  });
}
