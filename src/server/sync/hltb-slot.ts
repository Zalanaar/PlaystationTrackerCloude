// Слот массового прогона HLTB (контракт 16.7, п. 3): таблица hltb_runs, один running на систему, отдельно от слота синка.
import { and, eq, gte, lt } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';

const { hltbRuns } = schema;

export type HltbRunRow = typeof hltbRuns.$inferSelect;

/** Запуск HLTB укладывается в ~60 с (maxDuration) и пишет heartbeat после каждой пачки: брошенный закрываем быстро. */
export const HLTB_STALE_RUN_MS = 2 * 60_000;

function isUniqueViolation(e: unknown): boolean {
  let x: unknown = e;
  for (let i = 0; i < 4 && x && typeof x === 'object'; i++) {
    if ((x as { code?: unknown }).code === '23505') return true;
    x = (x as { cause?: unknown }).cause;
  }
  return false;
}

/** hltb_runs: running без heartbeat дольше 2 минут -> failed/timeout (функция убита по maxDuration). */
export async function closeStaleHltbRuns(db: AnyDb, now: Date): Promise<number> {
  const threshold = new Date(now.getTime() - HLTB_STALE_RUN_MS);
  const closed = await db
    .update(hltbRuns)
    .set({ status: 'failed', errorReason: 'timeout', errorMessage: 'Запуск завис и закрыт автоматически.', finishedAt: now })
    .where(and(eq(hltbRuns.status, 'running'), lt(hltbRuns.heartbeatAt, threshold)))
    .returning({ id: hltbRuns.id });
  return closed.length;
}

/**
 * Запуск массовой подгрузки HLTB (контракт 16.7, п. 3). Свой слот (hltb_runs, один running на систему):
 * синк и обход cron им не блокируются, и он не ждёт синк. Никогда не возобновляет прерванный.
 */
export async function startHltbRun(db: AnyDb, userId: UserId, now: Date): Promise<{ kind: 'started'; run: HltbRunRow } | { kind: 'already_running'; runId: number | null }> {
  await closeStaleHltbRuns(db, now);
  try {
    const [run] = await db.insert(hltbRuns).values({ userId, status: 'running', startedAt: now, heartbeatAt: now }).returning();
    return { kind: 'started', run };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const [running] = await db.select({ id: hltbRuns.id }).from(hltbRuns).where(eq(hltbRuns.status, 'running')).limit(1);
    return { kind: 'already_running', runId: running?.id ?? null };
  }
}

/** Идёт ли у пользователя массовый прогон HLTB (шаг HLTB в синке тогда пропускается, чтобы не делить одни игры). */
export async function hltbRunActive(db: AnyDb, userId: UserId, now: Date): Promise<boolean> {
  const fresh = new Date(now.getTime() - HLTB_STALE_RUN_MS);
  const [row] = await db
    .select({ id: hltbRuns.id })
    .from(hltbRuns)
    .where(and(eq(hltbRuns.userId, userId), eq(hltbRuns.status, 'running'), gte(hltbRuns.heartbeatAt, fresh)))
    .limit(1);
  return !!row;
}
