// Цели месяца на главной (решение Артёма 19.11): задаёт сам — сколько игр пройти, часов наиграть, трофеев взять.
// Прогресс: пройденные с completed_at в месяце МСК, часы по снимкам (как в статистике, без оценки пропусков), трофеи с earned_at.
import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { gameVisible, snapshotGameVisible, trophySetCounted } from '@/server/collection/visibility';
import { groupSnapshots, secondsByGame, secondsToHours } from '@/server/stats/hours';
import { resolvePeriod } from '@/server/stats/period';

const { gameStatus, monthGoals, playtimeSnapshots: ps, trophies } = schema;

export const GOAL_LIMITS = {
  games: { min: 1, max: 100 },
  hours: { min: 1, max: 744 },
  trophies: { min: 1, max: 5000 },
} as const;

export type GoalKey = keyof typeof GOAL_LIMITS;
export type GoalFields = { games: number | null; hours: number | null; trophies: number | null };
export type GoalProgress = { games: number; hours: number; trophies: number };
export type MonthGoalsView = {
  month: string;
  year: number;
  monthNum: number;
  goals: GoalFields;
  progress: GoalProgress;
  hasGoals: boolean;
};

const KEYS = ['games', 'hours', 'trophies'] as const satisfies readonly GoalKey[];

export function currentMonth(now: Date): { month: string; year: number; monthNum: number } {
  const s = new Date(now.getTime() + 3 * 3600_000);
  const year = s.getUTCFullYear();
  const monthNum = s.getUTCMonth() + 1;
  return { month: `${year}-${String(monthNum).padStart(2, '0')}`, year, monthNum };
}

export function hasGoals(g: GoalFields): boolean {
  return KEYS.some((k) => g[k] != null);
}

function asInt(v: unknown): number | null | undefined {
  if (v === null) return null;
  if (v === undefined) return undefined;
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isInteger(Number(v))) return Number(v);
  return undefined;
}

/** Разбор тела PUT: поля необязательны, null или целое в диапазоне; все null — снять цели. Иначе некорректно. */
export function parseGoals(input: unknown): { ok: true; value: GoalFields } | { ok: false } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { ok: false };
  const o = input as Record<string, unknown>;
  if (Object.keys(o).some((k) => !KEYS.includes(k as GoalKey))) return { ok: false };
  const value: GoalFields = { games: null, hours: null, trophies: null };
  for (const k of KEYS) {
    if (!(k in o)) continue;
    const n = asInt(o[k]);
    if (n === undefined) return { ok: false };
    if (n !== null && (n < GOAL_LIMITS[k].min || n > GOAL_LIMITS[k].max)) return { ok: false };
    value[k] = n;
  }
  return { ok: true, value };
}

export async function monthGoalProgress(db: AnyDb, userId: UserId, now: Date): Promise<GoalProgress> {
  const { year, monthNum } = currentMonth(now);
  const period = resolvePeriod('month', year, monthNum);
  const fromUtc = new Date(period.fromUtc);
  const toUtc = new Date(period.toUtc);
  const [completed, trophyRows, inMonth, bases] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(gameStatus)
      .where(and(eq(gameStatus.userId, userId), eq(gameStatus.status, 'completed'), gte(gameStatus.completedAt, fromUtc), lt(gameStatus.completedAt, toUtc), gameVisible(gameStatus.gameId, userId))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(trophies)
      .where(and(eq(trophies.userId, userId), eq(trophies.earned, true), gte(trophies.earnedAt, fromUtc), lt(trophies.earnedAt, toUtc), trophySetCounted(trophies.trophySetId, userId))),
    db
      .select({ gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(eq(ps.userId, userId), gte(ps.snapshotDate, period.from), lte(ps.snapshotDate, period.to), snapshotGameVisible(ps.gameId, userId))),
    db
      .selectDistinctOn([ps.gameId], { gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(eq(ps.userId, userId), lt(ps.snapshotDate, period.from), snapshotGameVisible(ps.gameId, userId)))
      .orderBy(ps.gameId, desc(ps.snapshotDate)),
  ]);
  const by = groupSnapshots([...bases, ...inMonth]);
  const hours = secondsToHours([...secondsByGame(by, period.from, period.to).values()].reduce((a, b) => a + b, 0));
  return { games: completed[0]?.n ?? 0, hours, trophies: trophyRows[0]?.n ?? 0 };
}

export async function getMonthGoals(db: AnyDb, userId: UserId, now: Date): Promise<MonthGoalsView> {
  const cur = currentMonth(now);
  const [row] = await db.select().from(monthGoals).where(and(eq(monthGoals.userId, userId), eq(monthGoals.month, cur.month))).limit(1);
  const goals: GoalFields = { games: row?.games ?? null, hours: row?.hours ?? null, trophies: row?.trophies ?? null };
  return { ...cur, goals, progress: await monthGoalProgress(db, userId, now), hasGoals: hasGoals(goals) };
}

/** Сохранить цели текущего месяца. Все поля null — удалить строку. */
export async function saveMonthGoals(db: AnyDb, userId: UserId, now: Date, goals: GoalFields): Promise<MonthGoalsView> {
  const { month } = currentMonth(now);
  if (!hasGoals(goals)) {
    await db.delete(monthGoals).where(and(eq(monthGoals.userId, userId), eq(monthGoals.month, month)));
  } else {
    await db
      .insert(monthGoals)
      .values({ userId, month, games: goals.games, hours: goals.hours, trophies: goals.trophies, updatedAt: now })
      .onConflictDoUpdate({ target: [monthGoals.userId, monthGoals.month], set: { games: goals.games, hours: goals.hours, trophies: goals.trophies, updatedAt: now } });
  }
  return getMonthGoals(db, userId, now);
}
