// «Входящие» (контракт Фазы 28): выборки. Каждый запрос несёт user_id; части независимы, сбой одной не роняет остальные.
import { and, asc, desc, eq, gt, gte, lte, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { forgottenSql, visibleGames } from '@/server/collection/query';
import { snapshotGameVisible, trophySetCounted } from '@/server/collection/visibility';
import { getDuplicateMap, mergeDuplicateSnapshots } from '@/server/stats/duplicates';
import type { Snapshot } from '@/server/stats/hours';
import { countMatches } from '@/server/manual/store';
import { countStatusHints } from '@/server/sync/status-hints-db';
import { calcInboxHours, countByWindow, INBOX_PARTS, inWindow, isInboxEmpty, weekRanges, windowSince, type InboxHours, type NewGamesPart, type TrophiesPart } from './calc';

const { games, gameStatus, syncRuns, trophies, playtimeSnapshots: ps } = schema;
const HOUR_MS = 3_600_000;

export type InboxResponse = {
  now: string;
  newGames: number | null;
  newGamesWindow: NewGamesPart['newGamesWindow'];
  newUnsorted: number | null;
  trophies: number | null;
  platinums: number | null;
  trophiesWindow: TrophiesPart['trophiesWindow'];
  hoursWeek: number | null;
  hoursPrevWeek: number | null;
  hoursNoHistory: boolean | null;
  checkCount: number | null;
  forgottenCount: number | null;
  /** Фаза 43: вопросы «Это та игра?» (игры «не куплено» с неуверенным совпадением). null = не удалось посчитать (в failed/partial не входит). */
  matchCount?: number | null;
  partial: boolean;
  failed: (typeof INBOX_PARTS)[number][];
  isEmpty: boolean;
};

/** Конец первичного импорта: игры, увиденные не позже, не считаются «новыми». null = у пользователя нет игр. */
async function initialImportEnd(db: AnyDb, userId: UserId): Promise<Date | null> {
  const [run] = await db
    .select({ startedAt: syncRuns.startedAt, finishedAt: syncRuns.finishedAt })
    .from(syncRuns)
    .where(and(eq(syncRuns.userId, userId), eq(syncRuns.status, 'success')))
    .orderBy(asc(syncRuns.startedAt))
    .limit(1);
  if (run) return run.finishedAt ?? new Date(run.startedAt.getTime() + HOUR_MS);
  const [g] = await db.select({ d: sql<Date | string | null>`min(${games.firstSeenAt})` }).from(games).where(eq(games.userId, userId));
  return g?.d ? new Date(new Date(g.d).getTime() + HOUR_MS) : null;
}

async function newGamesPart(db: AnyDb, userId: UserId, now: Date): Promise<NewGamesPart> {
  const since = windowSince('7d', now);
  const [end, rows] = await Promise.all([
    initialImportEnd(db, userId),
    db
      .select({ firstSeenAt: games.firstSeenAt, status: gameStatus.status })
      .from(games)
      .leftJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
      .where(and(eq(games.userId, userId), visibleGames, gt(games.firstSeenAt, since), lte(games.firstSeenAt, now))),
  ]);
  const fresh = rows.filter((r) => end !== null && r.firstSeenAt.getTime() > end.getTime());
  const w = countByWindow(fresh.map((r) => r.firstSeenAt), now);
  const sinceW = w.window === null ? null : windowSince(w.window, now);
  const inW = sinceW === null ? [] : fresh.filter((r) => inWindow(r.firstSeenAt, sinceW, now));
  return { newGames: inW.length, newGamesWindow: w.window, newUnsorted: inW.filter((r) => r.status === null).length };
}

async function trophiesPart(db: AnyDb, userId: UserId, now: Date): Promise<TrophiesPart> {
  const rows = await db
    .select({ type: trophies.type, earnedAt: trophies.earnedAt })
    .from(trophies)
    .where(and(eq(trophies.userId, userId), eq(trophies.earned, true), gt(trophies.earnedAt, windowSince('7d', now)), lte(trophies.earnedAt, now), trophySetCounted(trophies.trophySetId, userId)));
  const w = countByWindow(rows.map((r) => r.earnedAt), now);
  if (w.window === null) return { trophies: 0, platinums: 0, trophiesWindow: null };
  const since = windowSince(w.window, now);
  const inW = rows.filter((r) => inWindow(r.earnedAt, since, now));
  return { trophies: inW.length, platinums: inW.filter((r) => r.type === 'platinum').length, trophiesWindow: w.window };
}

async function hoursPart(db: AnyDb, userId: UserId, now: Date): Promise<InboxHours> {
  const { prevFrom, to } = weekRanges(now);
  const [dupMap, inRange, bases, first] = await Promise.all([
    getDuplicateMap(db, userId),
    db
      .select({ gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(eq(ps.userId, userId), gte(ps.snapshotDate, prevFrom), lte(ps.snapshotDate, to), snapshotGameVisible(ps.gameId, userId))),
    db
      .selectDistinctOn([ps.gameId], { gameId: ps.gameId, date: ps.snapshotDate, seconds: ps.playDurationSeconds })
      .from(ps)
      .where(and(eq(ps.userId, userId), sql`${ps.snapshotDate} < ${prevFrom}`, snapshotGameVisible(ps.gameId, userId)))
      .orderBy(ps.gameId, desc(ps.snapshotDate)),
    db.select({ d: sql<string | null>`min(${ps.snapshotDate})` }).from(ps).where(eq(ps.userId, userId)),
  ]);
  const snaps: Snapshot[] = mergeDuplicateSnapshots([...bases, ...inRange], dupMap);
  return calcInboxHours(snaps, first[0]?.d ?? null, now);
}

const forgottenPart = async (db: AnyDb, userId: UserId, now: Date) => {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(games)
    .leftJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
    .where(and(eq(games.userId, userId), forgottenSql(now)));
  return r?.n ?? 0;
};

export async function getInbox(db: AnyDb, userId: UserId, now: Date = new Date()): Promise<InboxResponse> {
  const matchCount = await countMatches(db, userId).catch(() => null);
  const settled = await Promise.allSettled([
    newGamesPart(db, userId, now),
    trophiesPart(db, userId, now),
    hoursPart(db, userId, now),
    countStatusHints(db, userId, now),
    forgottenPart(db, userId, now),
  ]);
  const val = <T>(i: number): T | null => (settled[i].status === 'fulfilled' ? (settled[i] as PromiseFulfilledResult<T>).value : null);
  const p = { newGames: val<NewGamesPart>(0), trophies: val<TrophiesPart>(1), hours: val<InboxHours>(2), checkCount: val<number>(3), forgottenCount: val<number>(4) };
  const failed = INBOX_PARTS.filter((_, i) => settled[i].status === 'rejected');
  return {
    now: now.toISOString(),
    newGames: p.newGames?.newGames ?? null,
    newGamesWindow: p.newGames?.newGamesWindow ?? null,
    newUnsorted: p.newGames?.newUnsorted ?? null,
    trophies: p.trophies?.trophies ?? null,
    platinums: p.trophies?.platinums ?? null,
    trophiesWindow: p.trophies?.trophiesWindow ?? null,
    hoursWeek: p.hours?.hoursWeek ?? null,
    hoursPrevWeek: p.hours?.hoursPrevWeek ?? null,
    hoursNoHistory: p.hours?.hoursNoHistory ?? null,
    checkCount: p.checkCount,
    forgottenCount: p.forgottenCount,
    matchCount,
    partial: failed.length > 0,
    failed,
    isEmpty: isInboxEmpty(p) && (matchCount ?? 0) === 0,
  };
}

export const allPartsFailed = (r: InboxResponse): boolean => r.failed.length === INBOX_PARTS.length;
