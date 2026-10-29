// Давность успешного синка по БД (контракт 20.2). Запуски kind='hltb' не учитываются (16.7).
import { and, asc, desc, eq, gt, ne } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { syncOverdue, type SyncOverdue } from '@/shared/sync';

const { syncRuns } = schema;

/** Идёт ли синк прямо сейчас (старт не старше 2 ч): тогда алерт «не запускался» не шлём. */
export const RUNNING_FRESH_MS = 2 * 3_600_000;

export async function getSyncOverdue(db: AnyDb, now: Date = new Date()): Promise<SyncOverdue> {
  const notHltb = ne(syncRuns.kind, 'hltb');
  const [ok] = await db
    .select({ at: syncRuns.finishedAt, startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .where(and(notHltb, eq(syncRuns.status, 'success')))
    .orderBy(desc(syncRuns.startedAt), desc(syncRuns.id))
    .limit(1);
  if (ok) return syncOverdue(ok.at ?? ok.startedAt, now);
  const [first] = await db.select({ startedAt: syncRuns.startedAt }).from(syncRuns).where(notHltb).orderBy(asc(syncRuns.startedAt), asc(syncRuns.id)).limit(1);
  return syncOverdue(first?.startedAt ?? null, now);
}

export async function isSyncRunningFresh(db: AnyDb, now: Date = new Date()): Promise<boolean> {
  const [r] = await db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(and(eq(syncRuns.status, 'running'), gt(syncRuns.startedAt, new Date(now.getTime() - RUNNING_FRESH_MS))))
    .limit(1);
  return !!r;
}
