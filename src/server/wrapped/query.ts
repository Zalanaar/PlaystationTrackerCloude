// Чтение данных для /api/wrapped (контракт 11). Расчёты в calc.ts/compose.ts, здесь только выборки.
import { toHttps } from '@/shared/https-url';
import { and, desc, eq, gte, inArray, isNotNull, lt, min, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { getPsnProfile } from '@/server/collection/profile';
import { getGamesByIds } from '@/server/collection/query';
import { effectiveGameIdSql, gameVisible, snapshotGameVisible, trophySetCounted, visibleGameRow } from '@/server/collection/visibility';
import type { FinishedEvent } from '@/server/stats/finished';
import type { GenreGame } from '@/server/stats/genre-stats';
import { getDuplicateMap, mergeDuplicateSnapshots } from '@/server/stats/duplicates';
import { getEstimateInputs } from '@/server/stats/estimate-query';
import { calcHours, estimateYears, groupSnapshots, type EstimateInput, type Snapshot } from '@/server/stats/hours';
import { mskDateString, mskMidnightUtc, ymd } from '@/server/stats/period';
import { getRareTrophies } from '@/server/stats/rare-query';
import type { EarnedTrophy } from '@/server/stats/trophies';
import { TOP_GAMES } from './calc';
import { composeWrapped } from './compose';
import type { WrappedPlatinum, WrappedResponse } from './types';

const { games, gameStatus, gameTrophySets, playtimeSnapshots: ps, trophies, trophySets } = schema;
const TZ = 'Europe/Moscow';

/** Годы с данными для карточек выбора года (11.1). Текущий год МСК есть всегда. Признак приближённый. */
export async function getWrappedYears(db: AnyDb, userId: UserId, currentYear: number, estimates: readonly EstimateInput[] = []): Promise<{ year: number; hasData: boolean }[]> {
  const yearOf = (col: unknown) => sql<number | null>`extract(year from (${col} at time zone ${TZ}))::int`;
  // Тот же критерий, что у часов года (1.6): S_end - S_base > 0 по игре, где S_base = снимок перед годом, иначе первый в году.
  // prev = предыдущий снимок игры; у первого снимка года это ровно «последний снимок до года».
  const withPrev = db
    .select({
      gameId: ps.gameId,
      y: sql<number>`extract(year from ${ps.snapshotDate})::int`.as('y'),
      date: ps.snapshotDate,
      sec: ps.playDurationSeconds,
      prev: sql<number | null>`lag(${ps.playDurationSeconds}) over (partition by ${ps.gameId} order by ${ps.snapshotDate})`.as('prev'),
    })
    .from(ps)
    .where(and(eq(ps.userId, userId), snapshotGameVisible(ps.gameId, userId)))
    .as('with_prev');
  const perYear = db
    .select({
      y: withPrev.y,
      delta: sql<number>`(array_agg(${withPrev.sec} order by ${withPrev.date} desc))[1] - coalesce((array_agg(${withPrev.prev} order by ${withPrev.date}))[1], (array_agg(${withPrev.sec} order by ${withPrev.date}))[1])`.as('delta'),
    })
    .from(withPrev)
    .groupBy(withPrev.gameId, withPrev.y)
    .as('per_year');
  const [hrs, tr, comp, drop] = await Promise.all([
    db.selectDistinct({ y: perYear.y }).from(perYear).where(sql`${perYear.delta} > 0`),
    db
      .selectDistinct({ y: yearOf(trophies.earnedAt) })
      .from(trophies)
      .where(and(eq(trophies.userId, userId), eq(trophies.earned, true), isNotNull(trophies.earnedAt), trophySetCounted(trophies.trophySetId, userId))),
    db
      .selectDistinct({ y: yearOf(gameStatus.completedAt) })
      .from(gameStatus)
      .where(and(eq(gameStatus.userId, userId), eq(gameStatus.status, 'completed'), isNotNull(gameStatus.completedAt), gameVisible(gameStatus.gameId, userId))),
    db
      .selectDistinct({ y: yearOf(gameStatus.droppedAt) })
      .from(gameStatus)
      .where(and(eq(gameStatus.userId, userId), eq(gameStatus.status, 'dropped'), isNotNull(gameStatus.droppedAt), gameVisible(gameStatus.gameId, userId))),
  ]);
  const set = new Set<number>();
  for (const r of [...hrs, ...tr, ...comp, ...drop]) if (r.y !== null) set.add(r.y);
  for (const y of estimateYears(estimates)) set.add(y);
  const all = new Set<number>([...set, currentYear]);
  return [...all].sort((a, b) => b - a).map((year) => ({ year, hasData: set.has(year) }));
}

export async function getWrapped(db: AnyDb, userId: UserId, year: number, onlineId: string | null, now: Date = new Date(), opts: { withService?: boolean } = {}): Promise<WrappedResponse> {
  const today = mskDateString(now);
  const currentYear = Number(today.slice(0, 4));
  const yearFrom = ymd(year, 1, 1);
  const yearTo = ymd(year, 12, 31);
  const fromUtc = mskMidnightUtc(year, 1, 1);
  const toUtc = mskMidnightUtc(year + 1, 1, 1);
  const earnedInYear = and(eq(trophies.userId, userId), eq(trophies.earned, true), gte(trophies.earnedAt, fromUtc), lt(trophies.earnedAt, toUtc), trophySetCounted(trophies.trophySetId, userId));

  const estimates = await getEstimateInputs(db, userId);
  const [years, inYear, bases, first, trophyRows, platRows, completedRows, droppedRows, genreRows, psnProf, rare] = await Promise.all([
    getWrappedYears(db, userId, currentYear, estimates),
    db
      .select({ gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(eq(ps.userId, userId), gte(ps.snapshotDate, yearFrom), sql`${ps.snapshotDate} <= ${yearTo}`, snapshotGameVisible(ps.gameId, userId))),
    db
      .selectDistinctOn([ps.gameId], { gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(eq(ps.userId, userId), lt(ps.snapshotDate, yearFrom), snapshotGameVisible(ps.gameId, userId)))
      .orderBy(ps.gameId, desc(ps.snapshotDate)),
    db.select({ d: min(ps.snapshotDate) }).from(ps).where(eq(ps.userId, userId)),
    db.select({ type: trophies.type, earnedAt: trophies.earnedAt }).from(trophies).where(earnedInYear),
    db
      .select({
        setId: trophies.trophySetId,
        at: trophies.earnedAt,
        name: trophies.name,
        earnedRate: trophies.earnedRate,
        rarity: trophies.rarity,
        setName: trophySets.name,
      })
      .from(trophies)
      .innerJoin(trophySets, and(eq(trophySets.id, trophies.trophySetId), eq(trophySets.userId, userId)))
      .where(and(earnedInYear, eq(trophies.type, 'platinum'))),
    db
      .select({ gameId: gameStatus.gameId, at: gameStatus.completedAt })
      .from(gameStatus)
      .where(and(eq(gameStatus.userId, userId), eq(gameStatus.status, 'completed'), gte(gameStatus.completedAt, fromUtc), lt(gameStatus.completedAt, toUtc), gameVisible(gameStatus.gameId, userId))),
    db
      .select({ gameId: gameStatus.gameId, at: gameStatus.droppedAt })
      .from(gameStatus)
      .where(and(eq(gameStatus.userId, userId), eq(gameStatus.status, 'dropped'), gte(gameStatus.droppedAt, fromUtc), lt(gameStatus.droppedAt, toUtc), gameVisible(gameStatus.gameId, userId))),
    db.select({ id: games.id, psnGenres: games.psnGenres, genresOverride: games.genresOverride }).from(games).where(and(eq(games.userId, userId), visibleGameRow())),
    getPsnProfile(db, userId),
    getRareTrophies(db, userId, { fromUtc, toUtc }, undefined, opts.withService === true),
  ]);

  // Игра сета платины: минимальный id видимой игры из game_trophy_sets (сет может быть у нескольких версий).
  const setIds = [...new Set(platRows.map((r) => r.setId))];
  const links = setIds.length
    ? await db
        .select({ setId: gameTrophySets.trophySetId, gameId: sql<number>`min(${effectiveGameIdSql('games')})` })
        .from(gameTrophySets)
        .innerJoin(games, and(eq(games.id, gameTrophySets.gameId), eq(games.userId, userId)))
        .where(and(eq(gameTrophySets.userId, userId), inArray(gameTrophySets.trophySetId, setIds), snapshotGameVisible(gameTrophySets.gameId, userId)))
        .groupBy(gameTrophySets.trophySetId)
    : [];
  const gameBySet = new Map(links.map((l) => [l.setId, l.gameId]));

  const finishedEvents: FinishedEvent[] = [
    ...completedRows.flatMap((r) => (r.at ? [{ gameId: r.gameId, kind: 'completed' as const, at: r.at }] : [])),
    ...droppedRows.flatMap((r) => (r.at ? [{ gameId: r.gameId, kind: 'dropped' as const, at: r.at }] : [])),
  ];

  const snapshots: Snapshot[] = mergeDuplicateSnapshots([...bases, ...inYear], await getDuplicateMap(db, userId));
  // Карточки (GameItem) грузим только для нужных игр: топ по часам (с запасом на ничью на границе топа), завершённые, игры платин.
  const yearSeconds = calcHours({ by: groupSnapshots(snapshots), estimates, period: { from: yearFrom, to: yearTo }, year, firstSnapshotDate: null, today }).seconds;
  const ranked = [...yearSeconds.entries()].sort((a, b) => b[1] - a[1]);
  const cutoff = ranked.length >= TOP_GAMES ? ranked[TOP_GAMES - 1][1] : 0;
  const needed = new Set<number>(finishedEvents.map((e) => e.gameId));
  for (const [id, s] of ranked) if (s >= cutoff) needed.add(id);
  for (const id of gameBySet.values()) if (id !== null) needed.add(id);
  const items = await getGamesByIds(db, userId, [...needed]);
  const gameById = new Map(items.map((g) => [g.id, g]));

  const platinums: WrappedPlatinum[] = platRows.flatMap((r) => {
    if (!r.at) return [];
    const gid = gameBySet.get(r.setId);
    return [
      {
        at: r.at.toISOString(),
        name: r.name,
        earnedRate: r.earnedRate === null ? null : Number(r.earnedRate),
        rarity: r.rarity,
        setName: r.setName,
        game: (gid !== undefined && gid !== null ? gameById.get(gid) : undefined) ?? null,
      },
    ];
  });
  const earned: EarnedTrophy[] = trophyRows;

  return composeWrapped({
    year,
    today,
    years,
    // ник: env важнее, иначе из сохранённого профиля PSN (12.4)
    onlineId: onlineId ?? psnProf?.onlineId ?? null,
    avatarUrl: toHttps(psnProf?.avatarUrl),
    snapshots,
    estimates,
    firstSnapshotDate: first[0]?.d ?? null,
    trophies: earned,
    platinums,
    finishedEvents,
    gameById,
    genreGames: new Map<number, GenreGame>(genreRows.map((g) => [g.id, g])),
    rareTrophies: rare,
  });
}
