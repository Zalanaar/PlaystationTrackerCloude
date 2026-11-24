// П13.4: «Первая неделя» — чек-лист нового пользователя на главной (контракт «П13.4»). Всё считается по данным;
// хранится только момент «Скрыть» (user_checklist). Тема и установка PWA — на клиенте.
import { and, count, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { visibleGameRow } from '@/server/collection/visibility';
import { currentMonth, hasGoals } from '@/shared/month-goals';

const { allowedUsers, userChecklist, syncRuns, gameStatus, games, monthGoals, monthGoalGames } = schema;

export const WEEK_MS = 7 * 24 * 3600_000;
/** Сколько статусов считаем «расставлены» (или все игры, если их меньше). */
export const STATUS_GOAL = 5;

export type ChecklistResponse = {
  show: boolean;
  /** конец первой недели (ISO); null — пользователь не найден */
  endsAt: string | null;
  items: {
    sync: boolean;
    statuses: { count: number; goal: number; done: boolean };
    hltb: boolean;
    monthGoals: boolean;
  } | null;
};

export async function getChecklist(db: AnyDb, userId: UserId, now: Date): Promise<ChecklistResponse> {
  const [u] = await db.select({ onboardedAt: allowedUsers.onboardedAt, createdAt: allowedUsers.createdAt, dismissed: userChecklist.dismissedAt })
    .from(allowedUsers).leftJoin(userChecklist, eq(userChecklist.userId, allowedUsers.id)).where(eq(allowedUsers.id, userId)).limit(1);
  if (!u) return { show: false, endsAt: null, items: null };
  const start = u.onboardedAt ?? u.createdAt;
  const ends = new Date(start.getTime() + WEEK_MS);
  if (u.dismissed || now.getTime() >= ends.getTime()) return { show: false, endsAt: ends.toISOString(), items: null };
  const month = currentMonth(now).month;
  const [[sync], [st], [vis], [hltb], [mgoal], [picks]] = await Promise.all([
    db.select({ n: count() }).from(syncRuns).where(and(eq(syncRuns.userId, userId), ne(syncRuns.kind, 'hltb'), inArray(syncRuns.status, ['success', 'partial']))),
    db.select({ n: count() }).from(gameStatus).innerJoin(games, and(eq(games.userId, gameStatus.userId), eq(games.id, gameStatus.gameId)))
      .where(and(eq(gameStatus.userId, userId), visibleGameRow())),
    db.select({ n: count() }).from(games).where(and(eq(games.userId, userId), visibleGameRow())),
    db.select({ n: count() }).from(games).where(and(eq(games.userId, userId), isNotNull(games.hltbCheckedAt))),
    db.select({ games: monthGoals.games, hours: monthGoals.hours }).from(monthGoals).where(and(eq(monthGoals.userId, userId), eq(monthGoals.month, month))).limit(1),
    db.select({ n: count() }).from(monthGoalGames).where(and(eq(monthGoalGames.userId, userId), eq(monthGoalGames.month, month))),
  ]);
  const goal = Math.max(1, Math.min(STATUS_GOAL, Number(vis.n)));
  const stCount = Number(st.n);
  return {
    show: true,
    endsAt: ends.toISOString(),
    items: {
      sync: Number(sync.n) > 0,
      statuses: { count: stCount, goal, done: stCount >= goal },
      hltb: Number(hltb.n) > 0,
      monthGoals: hasGoals({ games: mgoal?.games ?? null, hours: mgoal?.hours ?? null, trophies: null }, Number(picks.n)),
    },
  };
}

export async function dismissChecklist(db: AnyDb, userId: UserId, now: Date): Promise<void> {
  await db.insert(userChecklist).values({ userId, dismissedAt: now }).onConflictDoNothing();
}
