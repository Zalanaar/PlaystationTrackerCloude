// GET /api/sync/status (контракт 8.4). Только БД.
import { desc, eq, ne } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { PHASES, parseCursor } from './context';

const { syncRuns, psnAuth } = schema;

export async function getSyncStatus(db: AnyDb) {
  const [last] = await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt), desc(syncRuns.id)).limit(1);
  const [lastDone] = await db.select().from(syncRuns).where(ne(syncRuns.status, 'running')).orderBy(desc(syncRuns.startedAt), desc(syncRuns.id)).limit(1);
  const [lastSuccess] = await db
    .select({ finishedAt: syncRuns.finishedAt })
    .from(syncRuns)
    .where(eq(syncRuns.status, 'success'))
    .orderBy(desc(syncRuns.startedAt), desc(syncRuns.id))
    .limit(1);
  const [auth] = await db.select({ refreshExpiresAt: psnAuth.refreshExpiresAt }).from(psnAuth).where(eq(psnAuth.id, 1)).limit(1);

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
  };
}
