// Цели месяца на главной: выбранные игры (сначала из «Играю», потом из Плана) и часы; трофеи в UI больше нет.
// Прогресс игр: сколько выбранных уже в «Пройдено»; без выбора — сколько пройдено в месяце МСК (старые цели-числа).
// Часы по снимкам (как в статистике, без оценки пропусков). hoursHint — среднее за последние месяцы со снимками.
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { gameVisible, snapshotGameVisible, trophySetCounted } from '@/server/collection/visibility';
import { groupSnapshots, secondsByGame, secondsToHours } from '@/server/stats/hours';
import { resolvePeriod } from '@/server/stats/period';
import {
  currentMonth, hasGoals, GOAL_PICK_MAX,
  type GoalFields, type GoalGame, type GoalProgress, type MonthGoalsView, type ParsedGoals,
} from '@/shared/month-goals';

export {
  currentMonth, hasGoals, parseGoals, GOAL_LIMITS, GOAL_PICK_MAX,
  type GoalFields, type GoalGame, type GoalKey, type GoalProgress, type MonthGoalsView, type ParsedGoals,
} from '@/shared/month-goals';

const { gameStatus, games, monthGoals, monthGoalGames, playtimeSnapshots: ps, trophies, roadmapOrder } = schema;

const visibleGame = (userId: UserId) => and(eq(games.userId, userId), isNull(games.hiddenAt), isNull(games.duplicateOfGameId));

function toGoalGame(r: { id: number; title: string; coverUrl: string | null; status: string | null }): GoalGame {
  return { id: r.id, title: r.title, coverUrl: r.coverUrl, completed: r.status === 'completed' };
}

async function hoursInPeriod(db: AnyDb, userId: UserId, from: string, to: string, baseBefore: string): Promise<number> {
  const [inMonth, bases] = await Promise.all([
    db
      .select({ gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(eq(ps.userId, userId), gte(ps.snapshotDate, from), lte(ps.snapshotDate, to), snapshotGameVisible(ps.gameId, userId))),
    db
      .selectDistinctOn([ps.gameId], { gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(eq(ps.userId, userId), lt(ps.snapshotDate, baseBefore), snapshotGameVisible(ps.gameId, userId)))
      .orderBy(ps.gameId, desc(ps.snapshotDate)),
  ]);
  const by = groupSnapshots([...bases, ...inMonth]);
  return secondsToHours([...secondsByGame(by, from, to).values()].reduce((a, b) => a + b, 0));
}

/** Среднее часов за последние 1–6 полных месяцев МСК, в которых были часы по снимкам. */
export async function averageMonthlyHours(db: AnyDb, userId: UserId, now: Date): Promise<number | null> {
  const cur = currentMonth(now);
  const months: { from: string; to: string }[] = [];
  let y = cur.year, m = cur.monthNum;
  for (let i = 0; i < 6; i++) {
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
    const p = resolvePeriod('month', y, m);
    months.push({ from: p.from, to: p.to });
  }
  const oldest = months[months.length - 1];
  const newest = months[0];
  const [inRange, bases] = await Promise.all([
    db
      .select({ gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(eq(ps.userId, userId), gte(ps.snapshotDate, oldest.from), lte(ps.snapshotDate, newest.to), snapshotGameVisible(ps.gameId, userId))),
    db
      .selectDistinctOn([ps.gameId], { gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(eq(ps.userId, userId), lt(ps.snapshotDate, oldest.from), snapshotGameVisible(ps.gameId, userId)))
      .orderBy(ps.gameId, desc(ps.snapshotDate)),
  ]);
  const by = groupSnapshots([...bases, ...inRange]);
  const vals: number[] = [];
  for (const mo of months) {
    const h = secondsToHours([...secondsByGame(by, mo.from, mo.to).values()].reduce((a, b) => a + b, 0));
    if (h > 0) vals.push(h);
  }
  if (!vals.length) return null;
  const n = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  if (n < 1) return null;
  return Math.min(744, n);
}

export async function monthGoalProgress(db: AnyDb, userId: UserId, now: Date, pickedIds: number[] = []): Promise<GoalProgress> {
  const { year, monthNum } = currentMonth(now);
  const period = resolvePeriod('month', year, monthNum);
  const fromUtc = new Date(period.fromUtc);
  const toUtc = new Date(period.toUtc);
  const [completed, trophyRows, hours] = await Promise.all([
    pickedIds.length
      ? db
          .select({ n: sql<number>`count(*)::int` })
          .from(gameStatus)
          .where(and(
            eq(gameStatus.userId, userId),
            eq(gameStatus.status, 'completed'),
            inArray(gameStatus.gameId, pickedIds),
            gameVisible(gameStatus.gameId, userId),
          ))
      : db
          .select({ n: sql<number>`count(*)::int` })
          .from(gameStatus)
          .where(and(eq(gameStatus.userId, userId), eq(gameStatus.status, 'completed'), gte(gameStatus.completedAt, fromUtc), lt(gameStatus.completedAt, toUtc), gameVisible(gameStatus.gameId, userId))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(trophies)
      .where(and(eq(trophies.userId, userId), eq(trophies.earned, true), gte(trophies.earnedAt, fromUtc), lt(trophies.earnedAt, toUtc), trophySetCounted(trophies.trophySetId, userId))),
    hoursInPeriod(db, userId, period.from, period.to, period.from),
  ]);
  return { games: completed[0]?.n ?? 0, hours, trophies: trophyRows[0]?.n ?? 0 };
}

async function listPicked(db: AnyDb, userId: UserId, month: string): Promise<GoalGame[]> {
  try {
    const rows = await db
      .select({
        id: games.id,
        title: games.name,
        coverUrl: games.imageUrl,
        status: gameStatus.status,
        position: monthGoalGames.position,
      })
      .from(monthGoalGames)
      .innerJoin(games, and(eq(games.id, monthGoalGames.gameId), eq(games.userId, userId)))
      .leftJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
      .where(and(eq(monthGoalGames.userId, userId), eq(monthGoalGames.month, month), isNull(games.hiddenAt)))
      .orderBy(asc(monthGoalGames.position), asc(games.id));
    return rows.map(toGoalGame);
  } catch {
    // схема ещё без 0047 (окно между выкладкой кода и миграцией)
    return [];
  }
}

async function listCandidates(db: AnyDb, userId: UserId, pickedIds: number[]): Promise<{ playing: GoalGame[]; plan: GoalGame[] }> {
  const empty = { playing: [] as GoalGame[], plan: [] as GoalGame[] };
  const notPicked = pickedIds.length ? notInArray(games.id, pickedIds) : undefined;
  const notFinished = or(isNull(gameStatus.status), and(ne(gameStatus.status, 'completed'), ne(gameStatus.status, 'dropped'), ne(gameStatus.status, 'service')));
  try {
    const playing = await db
      .select({ id: games.id, title: games.name, coverUrl: games.imageUrl, status: gameStatus.status, last: games.lastPlayedAt })
      .from(games)
      .innerJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
      .where(and(visibleGame(userId), eq(gameStatus.status, 'playing'), notPicked))
      .orderBy(sql`${games.lastPlayedAt} desc nulls last`, desc(games.id))
      .limit(GOAL_PICK_MAX);
    const playingIds = playing.map((r) => r.id);
    const exclude = [...pickedIds, ...playingIds];
    const plan = await db
      .select({ id: games.id, title: games.name, coverUrl: games.imageUrl, status: gameStatus.status, position: roadmapOrder.position })
      .from(roadmapOrder)
      .innerJoin(games, and(eq(games.id, roadmapOrder.gameId), eq(games.userId, userId)))
      .leftJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
      .where(and(
        eq(roadmapOrder.userId, userId),
        visibleGame(userId),
        notFinished,
        exclude.length ? notInArray(games.id, exclude) : undefined,
      ))
      .orderBy(asc(roadmapOrder.position), asc(games.id))
      .limit(GOAL_PICK_MAX);
    return { playing: playing.map(toGoalGame), plan: plan.map(toGoalGame) };
  } catch {
    return empty;
  }
}

async function ownVisibleIds(db: AnyDb, userId: UserId, ids: number[]): Promise<number[]> {
  if (!ids.length) return [];
  const rows = await db
    .select({ id: games.id })
    .from(games)
    .where(and(visibleGame(userId), inArray(games.id, ids)));
  const ok = new Set(rows.map((r) => r.id));
  return ids.filter((id) => ok.has(id)).slice(0, GOAL_PICK_MAX);
}

async function replacePicks(db: AnyDb, userId: UserId, month: string, gameIds: number[]): Promise<void> {
  await db.delete(monthGoalGames).where(and(eq(monthGoalGames.userId, userId), eq(monthGoalGames.month, month)));
  if (!gameIds.length) return;
  await db.insert(monthGoalGames).values(gameIds.map((gameId, position) => ({ userId, month, gameId, position })));
}

export async function getMonthGoals(db: AnyDb, userId: UserId, now: Date): Promise<MonthGoalsView> {
  const cur = currentMonth(now);
  const [row] = await db.select().from(monthGoals).where(and(eq(monthGoals.userId, userId), eq(monthGoals.month, cur.month))).limit(1);
  const picked = await listPicked(db, userId, cur.month);
  const goals: GoalFields = {
    games: picked.length ? picked.length : (row?.games ?? null),
    hours: row?.hours ?? null,
    trophies: row?.trophies ?? null,
  };
  const [progress, candidates, hoursHint] = await Promise.all([
    monthGoalProgress(db, userId, now, picked.map((g) => g.id)),
    listCandidates(db, userId, picked.map((g) => g.id)),
    averageMonthlyHours(db, userId, now),
  ]);
  return { ...cur, goals, progress, hasGoals: hasGoals(goals, picked.length), picked, candidates, hoursHint };
}

/** Сохранить цели текущего месяца. Все видимые цели пустые — удалить строку. trophies в строке сохраняем, если пришли; иначе не трогаем. */
export async function saveMonthGoals(db: AnyDb, userId: UserId, now: Date, goals: ParsedGoals): Promise<MonthGoalsView> {
  const { month } = currentMonth(now);
  const [row] = await db.select().from(monthGoals).where(and(eq(monthGoals.userId, userId), eq(monthGoals.month, month))).limit(1);
  const trophiesVal = goals.trophies;
  const nextHours = goals.hours;
  let nextGames = goals.games;
  let ids: number[] | undefined = goals.gameIds;
  if (ids) ids = await ownVisibleIds(db, userId, ids);
  if (ids) nextGames = ids.length ? ids.length : null;

  const next: GoalFields = { games: nextGames, hours: nextHours, trophies: trophiesVal };
  const pickCount = ids ? ids.length : (row ? (await listPicked(db, userId, month)).length : 0);

  if (!hasGoals(next, ids ? ids.length : pickCount)) {
    await db.delete(monthGoals).where(and(eq(monthGoals.userId, userId), eq(monthGoals.month, month)));
  } else {
    await db
      .insert(monthGoals)
      .values({ userId, month, games: next.games, hours: next.hours, trophies: next.trophies, updatedAt: now })
      .onConflictDoUpdate({ target: [monthGoals.userId, monthGoals.month], set: { games: next.games, hours: next.hours, trophies: next.trophies, updatedAt: now } });
    if (ids) {
      try { await replacePicks(db, userId, month, ids); } catch { /* таблица 0047 ещё не применена */ }
    }
  }
  return getMonthGoals(db, userId, now);
}
