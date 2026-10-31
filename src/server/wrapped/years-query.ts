// Годы с данными для карточек выбора года (11.1). Вынесено из query.ts, чтобы «всё время» (26.2) не создавало цикл импортов.
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { gameVisible, snapshotGameVisible, trophySetCounted } from '@/server/collection/visibility';
import { estimateYears, type EstimateInput } from '@/server/stats/hours';

const { gameStatus, playtimeSnapshots: ps, trophies } = schema;
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
