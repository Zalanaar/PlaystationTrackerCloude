// Жизненный цикл запуска: старт, возобновление, закрытие брошенных. Контракт: 1.7, 8.2.
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { parseCursor, type RunRow } from './context';
import { MAX_HOPS } from './engine';
import { mskDate } from './time';

const { syncRuns } = schema;

export const STALE_RUN_MS = 15 * 60_000;
export const RESUME_WINDOW_MS = 6 * 3600_000;

export type RunKind = (typeof schema.syncRunKind.enumValues)[number];
export type StartResult =
  | { kind: 'started'; run: RunRow; resumed: boolean }
  | { kind: 'already_running'; runId: number | null }
  | { kind: 'not_resumable' };

function isUniqueViolation(e: unknown): boolean {
  let x: unknown = e;
  for (let i = 0; i < 4 && x && typeof x === 'object'; i++) {
    if ((x as { code?: unknown }).code === '23505') return true;
    x = (x as { cause?: unknown }).cause;
  }
  return false;
}

/** running без признаков жизни дольше 15 минут -> failed/timeout. Данные не трогаются. */
export async function closeStaleRuns(db: AnyDb, now: Date): Promise<number> {
  const threshold = new Date(now.getTime() - STALE_RUN_MS).toISOString();
  const closed = await db
    .update(syncRuns)
    .set({ status: 'failed', errorReason: 'timeout', errorMessage: 'Запуск завис и закрыт автоматически.', finishedAt: now })
    .where(and(eq(syncRuns.status, 'running'), sql`coalesce((${syncRuns.cursor}->>'heartbeat')::timestamptz, ${syncRuns.startedAt}) < ${threshold}::timestamptz`))
    .returning({ id: syncRuns.id });
  return closed.length;
}

async function resume(db: AnyDb, row: RunRow, now: Date, keepHops: boolean): Promise<RunRow | null> {
  const cur = parseCursor(row.cursor);
  const [updated] = await db
    .update(syncRuns)
    .set({
      status: 'running',
      errorReason: null,
      errorMessage: null,
      finishedAt: null,
      phase: 'auth',
      cursor: { ...cur, hops: keepHops ? cur.hops : 0, heartbeat: now.toISOString() },
    })
    .where(and(eq(syncRuns.id, row.id), eq(syncRuns.status, 'partial')))
    .returning();
  return updated ?? null;
}

export async function startRun(db: AnyDb, o: { kind: RunKind; now: Date; continueRunId?: number; /** номер звена от отправителя; проверяется на принимающей стороне */ hop?: number }): Promise<StartResult> {
  const { now } = o;
  await closeStaleRuns(db, now);
  try {
    if (o.continueRunId !== undefined) {
      const [row] = await db.select().from(syncRuns).where(eq(syncRuns.id, o.continueRunId)).limit(1);
      if (!row || row.status !== 'partial' || row.errorReason !== 'timeout') return { kind: 'not_resumable' };
      if (o.hop !== undefined && (o.hop > MAX_HOPS || o.hop !== parseCursor(row.cursor).hops)) return { kind: 'not_resumable' };
      if (parseCursor(row.cursor).hops > MAX_HOPS) return { kind: 'not_resumable' };
      const run = await resume(db, row, now, true);
      return run ? { kind: 'started', run, resumed: true } : { kind: 'not_resumable' };
    }
    const [last] = await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt), desc(syncRuns.id)).limit(1);
    if (last && last.status === 'partial' && now.getTime() - last.startedAt.getTime() < RESUME_WINDOW_MS) {
      const run = await resume(db, last, now, false);
      if (run) return { kind: 'started', run, resumed: true };
    }
    const [run] = await db
      .insert(syncRuns)
      .values({
        kind: o.kind,
        status: 'running',
        snapshotDate: mskDate(now),
        startedAt: now,
        phase: 'auth',
        cursor: { phase: 'games', hops: 0, heartbeat: now.toISOString() },
      })
      .returning();
    return { kind: 'started', run, resumed: false };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const [running] = await db.select({ id: syncRuns.id }).from(syncRuns).where(eq(syncRuns.status, 'running')).limit(1);
    return { kind: 'already_running', runId: running?.id ?? null };
  }
}
