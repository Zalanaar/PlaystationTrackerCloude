// GET /api/sync/status (контракт 8.4). Только БД.
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { PHASES, parseCursor } from './context';
import { getSyncOverdue } from './overdue';

const { syncRuns, psnAuth } = schema;

// Запуски kind='hltb' (контракт 16.7) в индикации синка не участвуют.
const notHltbOf = (userId: UserId) => and(eq(syncRuns.userId, userId), ne(syncRuns.kind, 'hltb'));

export async function getSyncStatus(db: AnyDb, userId: UserId, now: Date = new Date()) {
  const notHltb = notHltbOf(userId);
  const [last] = await db.select().from(syncRuns).where(notHltb).orderBy(desc(syncRuns.startedAt), desc(syncRuns.id)).limit(1);
  const [lastDone] = await db.select().from(syncRuns).where(and(notHltb, ne(syncRuns.status, 'running'))).orderBy(desc(syncRuns.startedAt), desc(syncRuns.id)).limit(1);
  const [lastSuccess] = await db
    .select({ finishedAt: syncRuns.finishedAt })
    .from(syncRuns)
    .where(and(notHltb, eq(syncRuns.status, 'success')))
    .orderBy(desc(syncRuns.startedAt), desc(syncRuns.id))
    .limit(1);
  const [auth] = await db.select({ refreshExpiresAt: psnAuth.refreshExpiresAt }).from(psnAuth).where(eq(psnAuth.id, 1)).limit(1);

  // Один запрос: скалярные подзапросы-агрегаты, без N+1.
  const totalsRes = await db.execute(sql`
    select
      (select count(*) from games where user_id = ${userId})::int as games,
      (select count(*) from trophy_sets where user_id = ${userId})::int as trophy_sets,
      count(*)::int as trophies,
      (count(*) filter (where earned))::int as trophies_earned,
      (count(*) filter (where earned and type = 'platinum'))::int as platinum_earned
    from trophies where user_id = ${userId}`);
  const rows = (Array.isArray(totalsRes) ? totalsRes : (totalsRes as { rows: unknown[] }).rows) as Record<string, number>[];
  const tr = rows[0] ?? {};
  const totals = {
    games: Number(tr.games ?? 0),
    trophySets: Number(tr.trophy_sets ?? 0),
    trophies: Number(tr.trophies ?? 0),
    trophiesEarned: Number(tr.trophies_earned ?? 0),
    platinumEarned: Number(tr.platinum_earned ?? 0),
  };

  const authFailed = lastDone?.errorReason === 'auth_expired' || lastDone?.errorReason === 'npsso_invalid';
  const psnAuthState = !lastDone ? 'unknown' : authFailed ? 'auth_expired' : 'ok';

  let run = null;
  if (last) {
    const cur = parseCursor(last.cursor);
    const phase = last.phase && (PHASES as readonly string[]).includes(last.phase) ? (last.phase as (typeof PHASES)[number]) : cur.phase;
    const withProgress = (phase === 'trophy_link' || phase === 'trophies') && cur.phase === phase && cur.progress;
    run = {
      id: last.id,
      kind: last.kind,
      status: last.status,
      phase: last.phase,
      errorReason: last.errorReason,
      errorMessage: last.errorMessage,
      startedAt: last.startedAt.toISOString(),
      finishedAt: last.finishedAt ? last.finishedAt.toISOString() : null,
      snapshotDate: last.snapshotDate,
      progress: {
        phase,
        step: PHASES.indexOf(phase) + 1,
        steps: PHASES.length,
        done: withProgress ? withProgress.done : null,
        total: withProgress ? withProgress.total : null,
      },
      counters: {
        gamesSeen: last.gamesSeen,
        gamesUpserted: last.gamesUpserted,
        snapshotsWritten: last.snapshotsWritten,
        trophySetsSynced: last.trophySetsSynced,
        trophiesUpserted: last.trophiesUpserted,
      },
      warningsCount: Array.isArray(last.warnings) ? last.warnings.length : 0,
    };
  }

  return {
    running: last?.status === 'running',
    run,
    lastSuccessAt: lastSuccess?.finishedAt ? lastSuccess.finishedAt.toISOString() : null,
    psnAuth: psnAuthState,
    psnAuthExpiresAt: auth?.refreshExpiresAt ? auth.refreshExpiresAt.toISOString() : null,
    totals,
    overdue: await getSyncOverdue(db, userId, now),
  };
}
